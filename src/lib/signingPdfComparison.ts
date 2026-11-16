import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNull, PDFNumber, PDFRawStream, PDFRef, PDFSignature, type PDFObject } from 'pdf-lib';
import { Inflate } from 'pako';
import { inspectSigningPdf, manualSignatureFieldName, signaturePdfRectangle, type ManualSignature, type SigningPage } from './manualSignatureFields';

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

/** Bounded fingerprints without trusting object numbers or decoding images.
 * Resource cycles remain inconclusive. Annotation/field parent and page links
 * use canonical backreferences so ordinary widget hierarchies stay comparable.
 */
async function documentGraphDigests(pdf: PDFDocument, projection: 'resources' | 'contents' | 'annotations' | 'fields' = 'resources',
  excluded: ReadonlySet<PDFObject> = new Set()): Promise<string[] | null> {
  let total = 0, nodes = 0;
  try {
    const digests: string[] = [];
    const pageNumbers = new Map<PDFObject, number>(pdf.getPages().map((page, index) => [page.node, index]));
    const roots = projection === 'fields'
      ? [pdf.context.obj(pdf.getForm().getFields().map(field => field.acroField.dict).filter(field => !excluded.has(field)))]
      : pdf.getPages().map(page => projection === 'resources' ? page.node.Resources() : projection === 'contents' ? page.node.Contents()
        : pdf.context.obj((page.node.Annots()?.asArray() ?? []).filter(value => {
          const resolved = pdf.context.lookup(value); return !resolved || !excluded.has(resolved);
        })));
    for (const root of roots) {
      const parts: Uint8Array[] = [], ancestors = new Set<PDFObject>();
      const seenObjects = new Map<PDFObject, number>();
      let length = 0;
      const append = (value: Uint8Array) => {
        length += value.length; total += value.length;
        if (length > MAX_CONTENT_BYTES || total > MAX_DOCUMENT_CONTENT_BYTES) throw new Error('Resource comparison limit exceeded.');
        parts.push(value);
      };
      const tag = (value: string) => {
        const encoded = new TextEncoder().encode(value), framed = new Uint8Array(encoded.length + 4);
        new DataView(framed.buffer).setUint32(0, encoded.length); framed.set(encoded, 4); append(framed);
      };
      const walk = (value: PDFObject | undefined, depth = 0): void => {
        if (++nodes > 50_000 || depth > 40) throw new Error('Resource graph comparison limit exceeded.');
        if (value instanceof PDFRef) { walk(pdf.context.lookup(value), depth + 1); return; }
        if (!value) { tag('absent'); return; }
        if (projection === 'annotations' || projection === 'fields') {
          const pageNumber = pageNumbers.get(value);
          if (pageNumber !== undefined) { tag(`page:${pageNumber}`); return; }
          if (seenObjects.has(value)) { tag(`reference:${seenObjects.get(value)}`); return; }
          seenObjects.set(value, seenObjects.size);
        }
        if (ancestors.has(value)) throw new Error('Cyclic page resources require manual review.');
        ancestors.add(value);
        try {
          if (value instanceof PDFRawStream) {
            tag('stream'); walk(value.dict, depth + 1);
            const bytes = value.getContents(); tag(String(bytes.length)); append(bytes);
          } else if (value instanceof PDFDict) {
            const entries = value.entries().sort(([first], [second]) => first.asString().localeCompare(second.asString()));
            tag(`dictionary:${entries.length}`);
            for (const [key, child] of entries) { tag(key.asString()); walk(child, depth + 1); }
          } else if (value instanceof PDFArray) {
            tag(`array:${value.size()}`);
            for (let index = 0; index < value.size(); index++) walk(value.get(index), depth + 1);
          } else tag(value.toString());
        } finally { ancestors.delete(value); }
      };
      walk(root);
      const bytes = new Uint8Array(length); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      digests.push([...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join(''));
    }
    return digests;
  } catch { return null; }
}

export async function compareSigningPdfs(original: Uint8Array, returned: Uint8Array, handoffId: string) {
  const before = await inspectSigningPdf(original), after = await inspectSigningPdf(returned, true);
  const first = await PDFDocument.load(original), second = await PDFDocument.load(returned);
  const originalContents = await contentDigests(first), returnedContents = await contentDigests(second);
  const originalResources = await documentGraphDigests(first), returnedResources = await documentGraphDigests(second);
  const originalPrefix = returned.length >= original.length && original.every((value, index) => returned[index] === value);
  const sameBytes = originalPrefix && original.length === returned.length;
  const checks = {
    samePageGeometry: JSON.stringify(before.pages) === JSON.stringify(after.pages),
    contentComparisonAvailable: originalContents !== null && returnedContents !== null,
    sameContentStreams: originalContents !== null && returnedContents !== null && JSON.stringify(originalContents) === JSON.stringify(returnedContents),
    resourceComparisonAvailable: originalResources !== null && returnedResources !== null,
    samePageResources: originalResources !== null && returnedResources !== null && JSON.stringify(originalResources) === JSON.stringify(returnedResources),
    originalPrefix, matchingHandoffMarker: (second.getKeywords() ?? '').includes(`DonDocs handoff ${handoffId}`),
    signatureValuesPresent: second.getForm().getFields().filter(field => field instanceof PDFSignature
      && field.acroField.dict.lookup(PDFName.of('V')) !== undefined && field.acroField.dict.lookup(PDFName.of('V')) !== PDFNull).length,
  };
  const assessment = sameBytes ? 'unchanged' as const
    : !checks.samePageGeometry || checks.contentComparisonAvailable && (!checks.sameContentStreams
      || checks.resourceComparisonAvailable && !checks.samePageResources) ? 'different' as const
      : checks.contentComparisonAvailable && checks.sameContentStreams && checks.resourceComparisonAvailable
        && checks.samePageResources && checks.matchingHandoffMarker ? 'checks-agree' as const
        : 'inconclusive' as const;
  return { assessment, checks };
}

interface RetainedSigningPdf { data: string; pages: SigningPage[]; existingFieldNames: string[] }
function emptyHandoffWidget(widget: PDFDict, width: number, height: number): boolean {
  const allowed = new Set(['Type', 'Subtype', 'FT', 'T', 'Rect', 'F', 'P', 'Border', 'AP']);
  if (widget.keys().some(key => !allowed.has(key.decodeText()))) return false;
  const appearance = widget.lookupMaybe(PDFName.of('AP'), PDFDict);
  const stream = appearance?.lookup(PDFName.of('N'));
  if (!appearance || appearance.keys().some(key => key.decodeText() !== 'N') || !(stream instanceof PDFRawStream)) return false;
  if (stream.getContents().length !== 3 || stream.getContents().some((value, index) => value !== [113, 32, 81][index])) return false;
  const streamKeys = new Set(['Type', 'Subtype', 'FormType', 'BBox', 'Length']);
  if (stream.dict.keys().some(key => !streamKeys.has(key.decodeText()))) return false;
  const bounds = stream.dict.lookupMaybe(PDFName.of('BBox'), PDFArray), border = widget.lookupMaybe(PDFName.of('Border'), PDFArray);
  const numbers = (array: PDFArray | undefined, expected: number[]) => array?.size() === expected.length
    && array.asArray().every((value, index) => value instanceof PDFNumber && Math.abs(value.asNumber() - expected[index]) <= 0.000001);
  return numbers(bounds, [0, 0, width, height]) && numbers(border, [0, 0, 0])
    && widget.lookupMaybe(PDFName.of('Type'), PDFName)?.decodeText() === 'Annot'
    && widget.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() === 'Widget'
    && widget.lookupMaybe(PDFName.of('F'), PDFNumber)?.asNumber() === 4
    && stream.dict.lookupMaybe(PDFName.of('Type'), PDFName)?.decodeText() === 'XObject'
    && stream.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() === 'Form'
    && stream.dict.lookupMaybe(PDFName.of('FormType'), PDFNumber)?.asNumber() === 1;
}
/** A saved handoff may add declared signature widgets, never a different source body.
 * Raw stream fingerprints include filters/parameters without decompressing them.
 * Call only after validating the retained PDFs and their recorded inspections.
 */
export async function assertSigningHandoffRelation(source: RetainedSigningPdf,
  handoff: { id: string; pdf: RetainedSigningPdf; fields: ManualSignature[] }): Promise<void> {
  const { base64ToUint8Array } = await import('./encoding');
  const first = await PDFDocument.load(base64ToUint8Array(source.data));
  const second = await PDFDocument.load(base64ToUint8Array(handoff.pdf.data));
  const names = [...source.existingFieldNames, ...handoff.fields.map(manualSignatureFieldName)];
  if (JSON.stringify(names) !== JSON.stringify(handoff.pdf.existingFieldNames))
    throw new Error('The signing handoff fields do not match their saved assignments.');
  const addedWidgets = new Set<PDFObject>();
  for (const field of handoff.fields) {
    const signature = second.getForm().getField(manualSignatureFieldName(field));
    if (!(signature instanceof PDFSignature)) throw new Error('The saved signing handoff is missing its assigned signature field.');
    const widgets = signature.acroField.getWidgets();
    const rectangle = widgets[0]?.getRectangle(), expected = signaturePdfRectangle(field, source.pages[field.page]);
    if (widgets.length !== 1 || widgets[0].dict.lookup(PDFName.of('P')) !== second.getPage(field.page).node || !rectangle
      || [rectangle.x, rectangle.y, rectangle.x + rectangle.width, rectangle.y + rectangle.height]
        .some((value, index) => Math.abs(value - expected[index]) > 0.000001))
      throw new Error('The signing handoff box does not match its saved page and placement.');
    if (!emptyHandoffWidget(widgets[0].dict, rectangle.width, rectangle.height))
      throw new Error('A new signing handoff widget has an unexpected appearance or action.');
    addedWidgets.add(widgets[0].dict);
  }
  const content = await documentGraphDigests(first, 'contents'), handedContent = await documentGraphDigests(second, 'contents');
  const resources = await documentGraphDigests(first), handedResources = await documentGraphDigests(second);
  const annotations = await documentGraphDigests(first, 'annotations'), handedAnnotations = await documentGraphDigests(second, 'annotations', addedWidgets);
  const existingFields = await documentGraphDigests(first, 'fields'), handedFields = await documentGraphDigests(second, 'fields', addedWidgets);
  if (!content || !handedContent || !resources || !handedResources || !annotations || !handedAnnotations || !existingFields || !handedFields)
    throw new Error('The signing handoff exceeds the bounded source comparison limits. Use a simpler unsigned source PDF.');
  if (JSON.stringify(source.pages) !== JSON.stringify(handoff.pdf.pages)
    || JSON.stringify(content) !== JSON.stringify(handedContent) || JSON.stringify(resources) !== JSON.stringify(handedResources)
    || JSON.stringify(annotations) !== JSON.stringify(handedAnnotations)
    || JSON.stringify(existingFields) !== JSON.stringify(handedFields)
    || !(second.getKeywords() ?? '').includes(`DonDocs handoff ${handoff.id}`))
    throw new Error('The saved signing handoff does not preserve its claimed source PDF.');
}
