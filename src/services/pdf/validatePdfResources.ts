import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFObject, type PDFPage } from 'pdf-lib';
import { Inflate } from 'pako';
import { validatePdfJpeg } from './validatePdfJpeg';

export const PDF_RESOURCE_LIMITS = Object.freeze({
  resources: 10_000,
  depth: 64,
  filters: 8,
  streamBytes: 64 * 1024 * 1024,
  decodedBytes: 128 * 1024 * 1024,
  milliseconds: 15_000,
});
const CHUNK_BYTES = 64 * 1024;
const IMAGE_CODECS = new Set(['/DCTDecode', '/JPXDecode', '/CCITTFaxDecode', '/JBIG2Decode']);
const FILTER_ALIASES = new Map([
  ['Fl', 'FlateDecode'], ['LZW', 'LZWDecode'], ['A85', 'ASCII85Decode'],
  ['AHx', 'ASCIIHexDecode'], ['RL', 'RunLengthDecode'],
  ['DCT', 'DCTDecode'], ['CCF', 'CCITTFaxDecode'],
].map(([alias, full]) => [PDFName.of(alias), PDFName.of(full)]));

/** Validate compression in reachable page resources without replacing vector
 * content. JPEGs are decode-checked; other native codecs remain opaque. All
 * native image streams retain their encoded bytes in the assembled vector PDF.
 */
export function createPdfResourceValidator(pdf: PDFDocument, signal?: AbortSignal): (page: PDFPage) => Promise<void> {
  const visited = new Set<PDFObject>();
  const deadline = Date.now() + PDF_RESOURCE_LIMITS.milliseconds;
  let decodedBytes = 0;
  const check = () => {
    signal?.throwIfAborted();
    if (Date.now() > deadline) throw new Error('PDF resource validation timed out. Split this PDF and try again.');
  };

  const validateStream = async (stream: PDFRawStream) => {
    let streamBytes = 0;
    const charge = (size: number) => {
      check();
      streamBytes += size;decodedBytes += size;
      if (streamBytes > PDF_RESOURCE_LIMITS.streamBytes || decodedBytes > PDF_RESOURCE_LIMITS.decodedBytes) {
        throw new Error('PDF decoded resources exceed the preparation limit. Split this PDF and try again.');
      }
    };
    const filter = stream.dict.lookup(PDFName.of('Filter'));
    const original = filter instanceof PDFArray ? Array.from({ length: filter.size() }, (_, index) => filter.lookup(index, PDFName))
      : filter instanceof PDFName ? [filter] : [];
    if (filter && !(filter instanceof PDFArray) && !(filter instanceof PDFName)) throw new Error('PDF compression has an invalid filter.');
    const filters = original.map(name => FILTER_ALIASES.get(name) ?? name);
    if (filters.length > PDF_RESOURCE_LIMITS.filters) throw new Error('PDF compression has too many filter stages.');
    // pdf-lib's page embedder recognizes canonical filter names only. Normalize
    // aliases on this working document; the retained upload bytes never change.
    if (filters.some((name, index) => name !== original[index])) {
      stream.dict.set(PDFName.of('Filter'), filter instanceof PDFArray ? pdf.context.obj(filters) : filters[0]);
    }
    let bytes = stream.getContents();
    if (!filters.length) { charge(bytes.length);return; }
    for (let index = 0; index < filters.length; index++) {
      const encoding = filters[index];
      if (!(encoding instanceof PDFName)) throw new Error('PDF compression has an invalid filter.');
      if (stream.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image') && IMAGE_CODECS.has(encoding.asString()) && index === filters.length - 1) {
        charge(bytes.length);
        if (encoding === PDFName.of('DCTDecode')) await validatePdfJpeg(bytes, check, charge);
        return;
      }
      const retain = index < filters.length - 1;
      const chunks: Uint8Array[] = [];
      let length = 0;
      const consume = (chunk: Uint8Array | Uint8ClampedArray) => {
        charge(chunk.length);
        if (retain) { chunks.push(new Uint8Array(chunk));length += chunk.length; }
      };
      if (encoding === PDFName.of('FlateDecode')) {
        // pdf-lib's FlateStream can expand a whole block before returning a
        // requested chunk. Pako calls onData while inflating, so bounds apply
        // before an attacker-controlled expansion can accumulate in memory.
        const inflater = new Inflate({ chunkSize: CHUNK_BYTES, windowBits: 15 });
        let complete = false;
        inflater.onData = chunk => consume(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
        inflater.onEnd = status => { if (status === 0) complete = true; };
        if (!inflater.push(bytes, true) || !complete) throw new Error('PDF compressed resource is corrupt or truncated.');
      } else {
        // Decode one stage at a time so a later Flate stage cannot bypass the
        // bounded inflater above. Other supported decoders have small blocks.
        const dictionary = stream.dict.clone(pdf.context);
        dictionary.set(PDFName.of('Filter'), encoding);
        const parameters = stream.dict.lookup(PDFName.of('DecodeParms'));
        const parameter = parameters instanceof PDFArray ? parameters.lookup(index) : parameters;
        if (parameter) dictionary.set(PDFName.of('DecodeParms'), parameter);
        else dictionary.delete(PDFName.of('DecodeParms'));
        const decoder = decodePDFRawStream(PDFRawStream.of(dictionary, bytes));
        for (;;) {
          const chunk = decoder.getBytes(CHUNK_BYTES);
          if (!chunk.length) break;
          consume(chunk);
        }
      }
      if (retain) {
        bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.length; }
      }
    }
  };

  const visit = async (input: PDFObject | undefined, depth: number): Promise<void> => {
    check();
    if (!input) return;
    const value = input instanceof PDFRef ? pdf.context.lookup(input) : input;
    if (!value) throw new Error('A referenced PDF resource is missing.');
    if (visited.has(value)) return;
    if (depth > PDF_RESOURCE_LIMITS.depth || visited.size >= PDF_RESOURCE_LIMITS.resources) throw new Error('PDF resources are too complex. Split this PDF and try again.');
    visited.add(value);
    if (value instanceof PDFStream) {
      if (value instanceof PDFRawStream) await validateStream(value);
      await visit(value.dict, depth + 1);
    } else if (value instanceof PDFDict) {
      for (const [, child] of value.entries()) await visit(child, depth + 1);
    } else if (value instanceof PDFArray) {
      for (const child of value.asArray()) await visit(child, depth + 1);
    }
  };

  return async page => {
    await visit(page.node.Contents(), 0);
    await visit(page.node.Resources(), 0);
    for (const annotation of page.node.Annots()?.asArray() ?? []) {
      const value = pdf.context.lookup(annotation);
      if (value instanceof PDFDict) await visit(value.get(PDFName.of('AP')), 0);
    }
  };
}
