import { readTaggedLink, taggedReferenceUrl } from './links';
import { TAGGED_PDF_STRUCTURE_LIMITS } from './limits';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, type PDFRef } from 'pdf-lib';
import { Inflate } from 'pako';
import { byteString, byteStringBytes, readPdfContent, type PdfContentOperation } from './contentStream';
import { createRasterDecodeBudget, fingerprintPdfRaster, TAGGED_RASTER_LIMITS, type PdfRasterBinding } from './raster';

export type PdfSemanticRole = 'Document' | 'Sect' | 'P' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5' | 'H6' | 'L' | 'LI' | 'Lbl' | 'LBody' | 'Table' | 'THead' | 'TBody' | 'TR' | 'TH' | 'TD' | 'Figure' | 'Caption' | 'Span' | 'Link';
export interface PdfSemanticNode {
  id: number;
  role: PdfSemanticRole;
  children?: readonly PdfSemanticNode[];
  altText?: string;
  linkUrl?: string;
  columnHeader?: boolean;
  repeatAsArtifact?: boolean;
  allowEmpty?: boolean;
}
export interface PdfTaggingPlan {
  nonce: string;
  title: string;
  language: string;
  nodes: readonly PdfSemanticNode[];
  artifactIds?: readonly number[];
  images?: Readonly<Record<number, PdfRasterBinding>>;
}
export interface TaggedPdfResult {
  bytes: Uint8Array;
  pageCount: number;
  associatedChunks: number;
  artifactChunks: number;
  contentPages: Readonly<Record<number, readonly number[]>>;
}

const PAINT = new Set(['Tj', 'TJ', "'", '"', 'Do', 'sh', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const EXISTING_MARKED = new Set(['BMC', 'BDC', 'EMC']);
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_NODES = TAGGED_PDF_STRUCTURE_LIMITS.nodes;
const ROLES = new Set('Document Sect P H1 H2 H3 H4 H5 H6 L LI Lbl LBody Table THead TBody TR TH TD Figure Caption Span Link'.split(' '));

function marker(operation: PdfContentOperation, nonce: string): { id: number; begin: boolean } | undefined {
  if (operation.operator !== 'DP' || operation.operands[0]?.kind !== 'name' || operation.operands[0].value !== 'DDTag') return;
  if (operation.operands.length !== 2 || operation.operands[1].kind !== 'dictionary') throw new Error('Malformed tagged PDF source point.');
  const children = operation.operands[1].children ?? [];
  if (children.length !== 6) throw new Error('Unexpected tagged PDF source properties.');
  const values = new Map(children.filter((_value, index) => index % 2 === 0).map((key, index) => [key.value, children[index * 2 + 1]]));
  if (values.size !== 3 || values.get('N')?.kind !== 'hex' || values.get('N')?.value !== nonce) throw new Error('Tagged PDF source identity does not match this export.');
  const id = values.get('I');
  const begin = values.get('B');
  if (id?.kind !== 'number' || !Number.isSafeInteger(id.value) || Number(id.value) < -1 || begin?.kind !== 'boolean') throw new Error('Invalid tagged PDF source identity.');
  return { id: Number(id.value), begin: Boolean(begin.value) };
}

/** Bound a completed projection before compilation and recheck at finishing. */
export function validatePdfTaggingPlan(plan: PdfTaggingPlan): Map<number, PdfSemanticNode> {
  if (!/^[0-9a-f]{32}$/.test(plan.nonce) || !plan.title.trim() || plan.title.length > 2000 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(plan.language) || !Array.isArray(plan.nodes)) throw new Error('Invalid tagged PDF document metadata.');
  const nodes = new Map<number, PdfSemanticNode>();
  const visit = (node: PdfSemanticNode, depth: number) => {
    if (nodes.size >= MAX_NODES) throw new Error('The document exceeds the qualified tagged structure limit. Split large tables or lists into separate documents.');
    if (depth > TAGGED_PDF_STRUCTURE_LIMITS.planDepth || !Number.isSafeInteger(node.id) || node.id < 0 || nodes.has(node.id)) throw new Error('Invalid or duplicate tagged PDF structure identity.');
    if (!ROLES.has(node.role)) throw new Error('Unsupported tagged PDF semantic role.');
    if (node.altText !== undefined && (typeof node.altText !== 'string' || node.altText.length > 2000)) throw new Error('Invalid tagged PDF alternative text.');
    if (node.role === 'Figure' && (!node.altText?.trim() || node.altText.length > 2000)) throw new Error('Every meaningful figure requires alternative text.');
    if ((node.role === 'Link') !== (node.linkUrl !== undefined) || (node.linkUrl !== undefined && (node.linkUrl.length > 8192 || taggedReferenceUrl(node.linkUrl) !== node.linkUrl))) throw new Error('Every tagged Link needs an explicit safe source URI.');
    if (node.repeatAsArtifact && node.role !== 'TH') throw new Error('Only repeated table headers can become structural-repeat artifacts.');
    if (node.allowEmpty && node.role !== 'TD') throw new Error('Only an explicitly empty table data cell may omit painted content.');
    nodes.set(node.id, node);
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  for (const node of plan.nodes) visit(node, 0);
  if (!nodes.size) throw new Error('The tagged PDF has no semantic content.');
  return nodes;
}

/** Converts only a fresh, owned, instrumented pdfTeX result. It does not infer
 * semantics from an arbitrary PDF, repair signed files or tag appended pages. */
export async function finishTaggedPdf(input: Uint8Array, sourcePlan: PdfTaggingPlan): Promise<TaggedPdfResult> {
  if (input.byteLength > MAX_BYTES) throw new Error('Tagged PDF input exceeds 32 MiB.');
  validatePdfTaggingPlan(sourcePlan);
  if ((sourcePlan.artifactIds?.length ?? 0) > MAX_NODES) throw new Error('Too many tagged PDF artifacts.');
  const copyNode = (node: PdfSemanticNode): PdfSemanticNode => ({ id: node.id, role: node.role,
    ...(node.linkUrl === undefined ? {} : { linkUrl: node.linkUrl }),
    ...(node.altText === undefined ? {} : { altText: node.altText }),
    ...(node.columnHeader ? { columnHeader: true } : {}),
    ...(node.repeatAsArtifact ? { repeatAsArtifact: true } : {}),
    ...(node.allowEmpty ? { allowEmpty: true } : {}),
    ...(node.children ? { children: node.children.map(copyNode) } : {}),
  });
  const plan: PdfTaggingPlan = { nonce: sourcePlan.nonce, title: sourcePlan.title, language: sourcePlan.language,
    nodes: sourcePlan.nodes.map(copyNode), artifactIds: [...sourcePlan.artifactIds ?? []] };
  const nodes = validatePdfTaggingPlan(plan);
  const artifacts = new Set([-1]);
  for (const id of plan.artifactIds ?? []) {
    if (!Number.isSafeInteger(id) || id < 0 || nodes.has(id) || artifacts.has(id) || artifacts.size > MAX_NODES) throw new Error('Invalid tagged PDF artifact identity.');
    artifacts.add(id);
  }
  const imageBindings = new Map<number, PdfRasterBinding>();
  const sourceImages = Object.entries(sourcePlan.images ?? {});
  if (sourceImages.length > 20) throw new Error('Tagged PDF output supports at most 20 raster bindings.');
  for (const [key, image] of sourceImages) {
    const id = Number(key);
    if (!/^\d+$/.test(key) || !Number.isSafeInteger(id) || (!artifacts.has(id) && nodes.get(id)?.role !== 'Figure')
      || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1
      || image.width > TAGGED_RASTER_LIMITS.dimension || image.height > TAGGED_RASTER_LIMITS.dimension || image.width * image.height > TAGGED_RASTER_LIMITS.pixels
      || !['dct', 'rgb'].includes(image.encoding) || !/^[a-f0-9]{64}$/.test(image.digest)
      || (image.encoding === 'rgb' ? !/^[a-f0-9]{64}$/.test(image.alphaDigest ?? '') : image.alphaDigest !== undefined)) throw new Error('Invalid owned tagged PDF raster binding.');
    imageBindings.set(id, { width: image.width, height: image.height, encoding: image.encoding, digest: image.digest,
      ...(image.alphaDigest ? { alphaDigest: image.alphaDigest } : {}) });
  }
  const pdf = await PDFDocument.load(new Uint8Array(input));
  if (pdf.getPageCount() > 100) throw new Error('Tagged PDF output exceeds 100 pages.');
  if (pdf.catalog.has(PDFName.of('StructTreeRoot')) || pdf.catalog.has(PDFName.of('AcroForm'))) throw new Error('Preexisting tags and form fields are not qualified for this tagged export.');
  const context = pdf.context;
  const structure = context.obj({ Type: 'StructTreeRoot' });
  const structureRef = context.register(structure);
  const document = context.obj({ Type: 'StructElem', S: 'Document', P: structureRef });
  const documentRef = context.register(document);
  const refs = new Map<number, PDFRef>();
  const elements = new Map<number, PDFDict>();
  const content = new Map<number, { page: number; mcid: number; pageRef: PDFRef }[]>();
  const create = (node: PdfSemanticNode, parent: PDFRef): PDFRef => {
    const element = context.obj({ Type: 'StructElem', S: node.role, P: parent });
    const ref = context.register(element);
    refs.set(node.id, ref);
    elements.set(node.id, element);
    if (node.altText || node.linkUrl) element.set(PDFName.of('Alt'), PDFHexString.fromText(node.altText || node.linkUrl!));
    if (node.columnHeader) element.set(PDFName.of('A'), context.obj({ O: 'Table', Scope: 'Column' }));
    const children = (node.children ?? []).map(child => create(child, ref));
    if (children.length) element.set(PDFName.of('K'), context.obj(children));
    return ref;
  };
  document.set(PDFName.of('K'), context.obj(plan.nodes.map(node => create(node, documentRef))));
  const parentNumbers: (number | PDFArray | PDFRef)[] = [];
  const annotationParents: (number | PDFRef)[] = [];
  const linkObjects = new Map<number, { ref: PDFRef; pageRef: PDFRef; page: number }[]>();
  const seenAnnotations = new Set<string>();
  let annotationKey = pdf.getPageCount();
  const stack: number[] = [];
  const repeatedArtifactScopes = new Set<number>();
  const seen = new Set<number>();
  const usedImages = new Map<number, number>();
  const rasterBudget = createRasterDecodeBudget();
  const rasterCache = new Map<PDFRawStream, Promise<PdfRasterBinding>>();
  let decodedBytes = 0;
  let associatedChunks = 0;
  let artifactChunks = 0;
  for (const [pageIndex, page] of pdf.getPages().entries()) {
    for (const value of page.node.Annots()?.asArray() ?? []) {
      if (seenAnnotations.size >= 5000) throw new Error('Too many tagged link annotations.');
      const { ref, annotation, uri } = readTaggedLink(context, value, page);
      if (seenAnnotations.has(ref.toString())) throw new Error('A tagged annotation occurs more than once.');
      seenAnnotations.add(ref.toString());
      const identity = annotation.lookupMaybe(PDFName.of('DDTagLink'), PDFHexString)?.asString();
      const id = annotation.lookupMaybe(PDFName.of('DDTagId'), PDFNumber)?.asNumber();
      const node = id === undefined ? undefined : nodes.get(id);
      if (identity !== plan.nonce || id === undefined || node?.role !== 'Link' || node.linkUrl !== uri) throw new Error('Link annotation does not match its owned source.');
      if (annotation.has(PDFName.of('StructParent'))) throw new Error('Preexisting annotation structure is not qualified.');
      annotation.delete(PDFName.of('DDTagLink')); annotation.delete(PDFName.of('DDTagId'));
      annotation.set(PDFName.of('StructParent'), PDFNumber.of(annotationKey));
      annotation.set(PDFName.of('P'), page.ref);
      annotation.set(PDFName.of('Contents'), PDFHexString.fromText(node.altText || uri));
      annotationParents.push(annotationKey++, refs.get(id)!);
      const objects = linkObjects.get(id) ?? [];
      objects.push({ ref, pageRef: page.ref, page: pageIndex }); linkObjects.set(id, objects);
    }
    const contents = page.node.Contents();
    const entries = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    if (!entries.length || entries.length > 64) throw new Error('Unexpected tagged PDF page streams.');
    const pieces = entries.map(entry => {
      const stream = context.lookup(entry);
      if (!(stream instanceof PDFRawStream)) throw new Error('Unknown tagged PDF content stream.');
      // pdfTeX emits Flate; reject other filters before decoding untrusted data.
      const filter = stream.dict.get(PDFName.of('Filter'));
      if (filter && (!(filter instanceof PDFName) || filter.asString() !== '/FlateDecode')) throw new Error('Unsupported tagged PDF stream filter.');
      if (stream.dict.has(PDFName.of('DecodeParms'))) throw new Error('PDF stream predictors are not qualified for tagged output.');
      let decoded: Uint8Array;
      if (!filter) {
        decodedBytes += stream.contents.length;
        if (decodedBytes > MAX_BYTES) throw new Error('Decoded tagged PDF content exceeds 32 MiB.');
        decoded = stream.contents;
      } else {
        const chunks: Uint8Array[] = [];
        const inflate = new Inflate({ chunkSize: 64 * 1024 });
        let size = 0;
        let complete = false;
        inflate.onData = chunk => {
          if (typeof chunk === 'string') throw new Error('Unexpected text PDF stream decoder.');
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          decodedBytes += bytes.length;
          size += bytes.length;
          if (decodedBytes > MAX_BYTES) throw new Error('Decoded tagged PDF content exceeds 32 MiB.');
          chunks.push(bytes);
        };
        inflate.onEnd = status => { if (status !== 0) throw new Error('Malformed compressed PDF content.'); complete = true; };
        if (!inflate.push(stream.contents, true) || !complete) throw new Error('Malformed compressed PDF content.');
        decoded = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { decoded.set(chunk, offset); offset += chunk.length; }
      }
      return byteString(decoded);
    });
    const source = pieces.join('\n');
    const operations = readPdfContent(source);
    const parents: PDFRef[] = [];
    const output: string[] = [];
    let cursor = 0;
    let painted = false;
    let textOpen = false;
    let graphicsDepth = 0;
    let compatibilityDepth = 0;
    const flush = (end: number) => {
      const segment = source.slice(cursor, end);
      cursor = end;
      if (!painted) { output.push(segment); return; }
      painted = false;
      const owner = stack.at(-1);
      if (owner === undefined) throw new Error(`Page ${pageIndex + 1} has painted content without a semantic or artifact scope.`);
      if (artifacts.has(owner) || repeatedArtifactScopes.has(stack.length - 1)) { output.push(`/Artifact BMC\n${segment}\nEMC\n`); artifactChunks++; return; }
      const ref = refs.get(owner);
      if (!ref) throw new Error('Unknown tagged PDF content owner.');
      const mcid = parents.length;
      parents.push(ref);
      const items = content.get(owner) ?? [];
      items.push({ page: pageIndex, mcid, pageRef: page.ref });
      content.set(owner, items);
      output.push(`/${nodes.get(owner)!.role} << /MCID ${mcid} >> BDC\n${segment}\nEMC\n`);
      associatedChunks++;
    };
    for (const operation of operations) {
      if (EXISTING_MARKED.has(operation.operator)) throw new Error('Preexisting marked content is not qualified for this export.');
      if (operation.operator === 'Do') {
        const owner = stack.at(-1);
        const expected = owner === undefined ? undefined : imageBindings.get(owner);
        const name = operation.operands[0];
        if (owner === undefined || !expected || operation.operands.length !== 1 || name?.kind !== 'name') throw new Error('An image or form XObject has no explicit owned raster binding.');
        const objects = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
        const image = objects && context.lookup(objects.get(PDFName.of(String(name.value))));
        if (!(image instanceof PDFRawStream)) throw new Error('The bound raster XObject is missing.');
        let pending = rasterCache.get(image);
        if (!pending) { pending = fingerprintPdfRaster(context, image, rasterBudget); rasterCache.set(image, pending); }
        const actual = await pending;
        if (actual.width !== expected.width || actual.height !== expected.height || actual.encoding !== expected.encoding
          || actual.digest !== expected.digest || actual.alphaDigest !== expected.alphaDigest) throw new Error('The painted PDF image does not match its owned source raster.');
        const count = (usedImages.get(owner) ?? 0) + 1;
        if (count > 1) throw new Error('A tagged raster binding painted more than its one planned image.');
        usedImages.set(owner, count);
      }
      if (operation.operator === 'BT') {
        if (textOpen || operation.operands.length) throw new Error('Invalid PDF text object boundary.');
        textOpen = true;
      } else if (operation.operator === 'ET') {
        if (!textOpen || operation.operands.length) throw new Error('Invalid PDF text object boundary.');
        textOpen = false;
      } else if (operation.operator === 'q') graphicsDepth++;
      else if (operation.operator === 'Q' && --graphicsDepth < 0) throw new Error('Unbalanced PDF graphics state.');
      else if (operation.operator === 'BX') compatibilityDepth++;
      else if (operation.operator === 'EX' && --compatibilityDepth < 0) throw new Error('Unbalanced PDF compatibility section.');
      if (graphicsDepth > 64 || compatibilityDepth > 16) throw new Error('PDF graphics nesting limit exceeded.');
      if (['Tj', 'TJ', "'", '"'].includes(operation.operator)) {
        if (!textOpen) throw new Error('PDF text paint occurs outside a text object.');
        const operands = operation.operands;
        const textValue = operation.operator === '"' ? operands[2] : operands[0];
        const string = (value: typeof textValue) => value?.kind === 'string' || value?.kind === 'hex';
        const valid = operation.operator === 'TJ'
          ? operands.length === 1 && textValue?.kind === 'array' && textValue.children?.every(value => string(value) || value.kind === 'number')
          : operation.operator === '"' ? operands.length === 3 && operands[0].kind === 'number' && operands[1].kind === 'number' && string(textValue)
            : operands.length === 1 && string(textValue);
        if (!valid) throw new Error('Invalid PDF text paint operands.');
      }
      if (operation.operator === 'Tf') {
        const [name, size] = operation.operands;
        if (!textOpen || operation.operands.length !== 2 || name.kind !== 'name' || size.kind !== 'number') throw new Error('Invalid PDF font selection.');
        const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
        const font = fonts?.lookupMaybe(PDFName.of(String(name.value)), PDFDict);
        const subtype = font?.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString();
        if (!subtype || !['/Type1', '/TrueType', '/Type0'].includes(subtype)) throw new Error('Missing or unqualified PDF font resource.');
      }
      const point = marker(operation, plan.nonce);
      if (point) {
        flush(operation.start);
        cursor = operation.end;
        if (point.begin) {
          if (!nodes.has(point.id) && !artifacts.has(point.id)) throw new Error('Unknown tagged PDF source block.');
          if (stack.length >= 16 || stack.includes(point.id)) throw new Error('Ambiguous nested tagged PDF source block.');
          if (nodes.get(point.id)?.repeatAsArtifact && seen.has(point.id)) repeatedArtifactScopes.add(stack.length);
          stack.push(point.id);
          if (nodes.has(point.id)) seen.add(point.id);
        } else {
          repeatedArtifactScopes.delete(stack.length - 1);
          if (stack.pop() !== point.id) throw new Error('Unbalanced tagged PDF source blocks.');
        }
      } else if (PAINT.has(operation.operator)) painted = true;
    }
    if (textOpen || graphicsDepth || compatibilityDepth) throw new Error('Unterminated PDF page graphics or text object.');
    flush(source.length);
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream(byteStringBytes(output.join('')))));
    page.node.set(PDFName.of('StructParents'), PDFNumber.of(pageIndex));
    page.node.set(PDFName.of('Tabs'), PDFName.of('S'));
    parentNumbers.push(pageIndex, context.obj(parents));
  }
  if (stack.length) throw new Error('The tagged PDF ends with an open semantic block.');
  for (const [id, node] of nodes) {
    if (!node.children?.length && !seen.has(id)) throw new Error('Expected tagged PDF source content is missing.');
    const chunks = content.get(id) ?? [];
    if (node.children?.length && chunks.length) throw new Error('Mixed container and painted content requires an explicit child sequence.');
    if (!node.children?.length) {
      if (!chunks.length && !node.allowEmpty) throw new Error('A tagged PDF structure leaf has no painted content.');
      const objects = linkObjects.get(id) ?? [];
      if (node.role === 'Link' && (!objects.length || objects.some(object => !chunks.some(chunk => chunk.page === object.page)) || chunks.some(chunk => !objects.some(object => object.page === chunk.page)))) throw new Error('Tagged link annotations do not cover their painted source pages.');
      elements.get(id)!.set(PDFName.of('K'), context.obj([
        ...chunks.map(item => context.obj({ Type: 'MCR', Pg: item.pageRef, MCID: item.mcid })),
        ...objects.map(item => context.obj({ Type: 'OBJR', Pg: item.pageRef, Obj: item.ref })),
      ]));
      // Expose figure page context without changing its marked-content references.
      const figurePage = chunks[0];
      if (node.role === 'Figure' && figurePage && chunks.every(item => item.page === figurePage.page)) {
        elements.get(id)!.set(PDFName.of('Pg'), figurePage.pageRef);
      }
    }
  }
  for (const id of imageBindings.keys()) if (!usedImages.has(id)) throw new Error('An expected source raster was not painted in the tagged PDF.');
  structure.set(PDFName.of('K'), context.obj([documentRef]));
  structure.set(PDFName.of('ParentTree'), context.register(context.obj({ Nums: [...parentNumbers, ...annotationParents] })));
  structure.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(annotationKey));
  pdf.catalog.set(PDFName.of('StructTreeRoot'), structureRef);
  pdf.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true, Suspects: false }));
  pdf.catalog.set(PDFName.of('Lang'), PDFHexString.fromText(plan.language));
  pdf.catalog.getOrCreateViewerPreferences().setDisplayDocTitle(true);
  pdf.setTitle(plan.title);
  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, pageCount: pdf.getPageCount(), associatedChunks, artifactChunks, contentPages: Object.fromEntries([...content].map(([id, chunks]) => [id, [...new Set(chunks.map(item => item.page))]])) };
}
