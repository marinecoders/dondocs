import { PDFArray, PDFDocument, PDFName, PDFNull, PDFRawStream, PDFSignature } from 'pdf-lib';
import { Inflate } from 'pako';
import { inspectSigningPdf } from './manualSignatureFields';

const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_CONTENT_BYTES = 32 * 1024 * 1024;

/** Compare content-stream bytes conservatively, without interpreting signatures. */
function contentBytes(stream: PDFRawStream): Uint8Array | null {
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  const name = filter instanceof PDFArray && filter.size() === 1 ? filter.lookup(0) : filter;
  if (!name || name === PDFNull) {
    const bytes = stream.getContents();return bytes.length <= MAX_CONTENT_BYTES ? bytes : null;
  }
  const parameters = stream.dict.lookup(PDFName.of('DecodeParms'));
  if (!(name instanceof PDFName) || name.decodeText() !== 'FlateDecode' || parameters && parameters !== PDFNull) return null;
  const chunks: Uint8Array[] = [];let size = 0;
  const inflater = new Inflate({ chunkSize: 64 * 1024 });
  inflater.onData = chunk => {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    size += bytes.length;
    if (size > MAX_CONTENT_BYTES) throw new Error('The PDF content exceeds the bounded comparison limit.');
    chunks.push(bytes);
  };
  inflater.push(stream.getContents(), true);
  if (inflater.err) return null;
  const bytes = new Uint8Array(size);let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.length; }
  return bytes;
}

async function contentDigests(pdf: PDFDocument): Promise<string[] | null> {
  const result: string[] = [];let total = 0;
  try {
    for (const page of pdf.getPages()) {
      const contents = page.node.Contents(), streams = contents instanceof PDFArray
        ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index)) : contents ? [contents] : [];
      const parts: Uint8Array[] = [];let length = 0;
      for (const stream of streams) {
        if (!(stream instanceof PDFRawStream)) return null;
        const bytes = contentBytes(stream);if (!bytes) return null;
        length += bytes.length + 4;total += bytes.length;
        if (length > MAX_CONTENT_BYTES || total > MAX_DOCUMENT_CONTENT_BYTES) return null;
        parts.push(bytes);
      }
      const framed = new Uint8Array(length), view = new DataView(framed.buffer);let offset = 0;
      for (const part of parts) { view.setUint32(offset, part.length);offset += 4;framed.set(part, offset);offset += part.length; }
      result.push([...new Uint8Array(await crypto.subtle.digest('SHA-256', framed))].map(value => value.toString(16).padStart(2, '0')).join(''));
    }
    return result;
  } catch { return null; }
}

export async function compareSigningPdfs(original: Uint8Array, returned: Uint8Array, handoffId: string) {
  const before = await inspectSigningPdf(original), after = await inspectSigningPdf(returned, true);
  const first = await PDFDocument.load(original), second = await PDFDocument.load(returned);
  const originalContents = await contentDigests(first), returnedContents = await contentDigests(second);
  const originalPrefix = returned.length >= original.length && original.every((value, index) => returned[index] === value);
  const sameBytes = originalPrefix && original.length === returned.length;
  const checks = {
    samePageGeometry: JSON.stringify(before.pages) === JSON.stringify(after.pages),
    contentComparisonAvailable: originalContents !== null && returnedContents !== null,
    sameContentStreams: originalContents !== null && returnedContents !== null && JSON.stringify(originalContents) === JSON.stringify(returnedContents),
    originalPrefix, matchingHandoffMarker: (second.getKeywords() ?? '').includes(`DonDocs handoff ${handoffId}`),
    signatureValuesPresent: second.getForm().getFields().filter(field => field instanceof PDFSignature
      && field.acroField.dict.lookup(PDFName.of('V')) !== undefined && field.acroField.dict.lookup(PDFName.of('V')) !== PDFNull).length,
  };
  const assessment = sameBytes ? 'unchanged' as const
    : !checks.samePageGeometry || checks.contentComparisonAvailable && !checks.sameContentStreams ? 'different' as const
      : checks.contentComparisonAvailable && checks.sameContentStreams && checks.matchingHandoffMarker ? 'checks-agree' as const
        : 'inconclusive' as const;
  return { assessment, checks };
}
