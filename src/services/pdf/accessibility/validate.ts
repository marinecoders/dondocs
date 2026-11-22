import { readTaggedLink } from './links';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString } from 'pdf-lib';
import { byteString, readPdfContent } from './contentStream';
import { inflateBounded } from './raster';
import { TAGGED_PDF_STRUCTURE_LIMITS } from './limits';

export interface TaggedPdfValidation {
  kind: 'generated-structure-check';
  pages: number;
  structureElements: number;
  associatedChunks: number;
  artifactChunks: number;
  paintedOperations: number;
  figures: number;
  columnHeaders: number;
  conformance: 'PDF/UA not established';
}
const NAME = (name: string) => PDFName.of(name);
const PAINT = new Set(['Tj', 'TJ', "'", '"', 'Do', 'sh', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const MAX_BYTES = 32 * 1024 * 1024;
const ROLES = new Set('Document Sect P H1 H2 H3 H4 H5 H6 L LI Lbl LBody Table THead TBody TR TH TD Figure Caption Span Link'.split(' '));
const REQUIRED_PARENTS: Record<string, readonly string[]> = {
  LI: ['L'], Lbl: ['LI'], LBody: ['LI'], THead: ['Table'], TBody: ['Table'], TR: ['THead', 'TBody'], TH: ['TR'], TD: ['TR'],
};
const ALLOWED_CHILDREN: Record<string, readonly string[]> = {
  L: ['LI'], LI: ['Lbl', 'LBody'], Table: ['THead', 'TBody'], THead: ['TR'], TBody: ['TR'], TR: ['TH', 'TD'],
};
const CONTAINERS = new Set(['Document', 'Sect', 'LBody', ...Object.keys(ALLOWED_CHILDREN)]);
const TABLE_CONTAINERS = new Set(['Table', 'THead', 'TBody', 'TR']);
function fail(message: string): never { throw new Error(`Tagged PDF validation failed: ${message}`); }

/** Read back the saved bytes, independently of the source manifest and writer's
 * counters. This validates our bounded generated format, not arbitrary imported
 * PDFs, linguistic alternatives, visual layout, or PDF/UA conformance. */
export async function validateGeneratedTaggedPdf(input: Uint8Array): Promise<TaggedPdfValidation> {
  if (!input.length || input.length > MAX_BYTES) fail('input size exceeds the generated format limit.');
  const pdf = await PDFDocument.load(new Uint8Array(input)); const context = pdf.context;
  const pages = pdf.getPages();
  if (!pages.length || pages.length > 100) fail('page count is outside the generated format limit.');
  if (pdf.catalog.has(NAME('AcroForm'))) fail('forms are outside the qualified format.');
  const annotations = new Map<string, { ref: PDFRef; annotation: PDFDict; pageIndex: number; key: number }>();
  for (const [pageIndex, page] of pages.entries()) for (const value of page.node.Annots()?.asArray() ?? []) {
    const link = readTaggedLink(context, value, page);
    const key = link.annotation.lookup(NAME('StructParent'), PDFNumber).asNumber();
    if (annotations.size >= 5000 || annotations.has(link.ref.toString()) || !Number.isSafeInteger(key) || key !== pages.length + annotations.size
      || link.annotation.get(NAME('P'))?.toString() !== page.ref.toString() || link.annotation.has(NAME('DDTagLink')) || link.annotation.has(NAME('DDTagId'))) fail('link annotation ownership or structure key is invalid.');
    const description = link.annotation.lookup(NAME('Contents'));
    if (!(description instanceof PDFString || description instanceof PDFHexString) || !description.decodeText().trim()) fail('link description is missing.');
    annotations.set(link.ref.toString(), { ...link, pageIndex, key });
  }
  if (!pdf.getTitle()?.trim()) fail('document title is missing.');
  const language = pdf.catalog.lookup(NAME('Lang'));
  if (!(language instanceof PDFString || language instanceof PDFHexString) || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language.decodeText())) fail('document language is missing or invalid.');
  const info = pdf.catalog.lookup(NAME('MarkInfo'), PDFDict);
  if (info.lookup(NAME('Marked'), PDFBool) !== PDFBool.True || info.lookupMaybe(NAME('Suspects'), PDFBool) === PDFBool.True) fail('marked document metadata is inconsistent.');
  if (pdf.catalog.lookup(NAME('ViewerPreferences'), PDFDict).lookup(NAME('DisplayDocTitle'), PDFBool) !== PDFBool.True) fail('the viewer is not configured to display the document title.');
  const tree = pdf.catalog.lookup(NAME('StructTreeRoot'), PDFDict);
  const rootRef = pdf.catalog.get(NAME('StructTreeRoot'));
  if (!(rootRef instanceof PDFRef)) fail('structure root must be an indirect object.');
  const parentNumbers = tree.lookup(NAME('ParentTree'), PDFDict).lookup(NAME('Nums'), PDFArray);
  if (parentNumbers.size() !== (pages.length + annotations.size) * 2) fail('parent number tree does not match the pages.');
  const parentArrays = pages.map((page, index) => {
    if (page.node.lookup(NAME('StructParents'), PDFNumber).asNumber() !== index || page.node.lookup(NAME('Tabs'), PDFName) !== NAME('S')) fail('page structure keys or tab order differ from their generated order.');
    if (parentNumbers.lookup(index * 2, PDFNumber).asNumber() !== index) fail('parent number tree keys are not contiguous.');
    const values = parentNumbers.lookup(index * 2 + 1, PDFArray);
    if (values.size() > 50_000) fail('page parent array is excessive.');
    return values;
  });
  const usedAnnotations = new Set<string>();
  const expected = new Map<string, PDFRef>(); const visited = new Set<string>();
  let elements = 0; let figures = 0; let headers = 0; let headingLevel = 0;
  const walk = (ref: PDFRef, parent: PDFRef, depth: number, parentRole?: string, inheritedGrid?: { columns?: number }) => {
    if (depth > TAGGED_PDF_STRUCTURE_LIMITS.planDepth + 1 || ++elements > TAGGED_PDF_STRUCTURE_LIMITS.nodes + 1 || visited.has(ref.toString())) fail('structure contains a cycle, duplicate or excessive depth.');
    visited.add(ref.toString());
    const element = context.lookup(ref, PDFDict);
    if (element.lookup(NAME('Type'), PDFName) !== NAME('StructElem') || element.get(NAME('P'))?.toString() !== parent.toString()) fail('structure element parent link is invalid.');
    const role = element.lookup(NAME('S'), PDFName).decodeText();
    if (!ROLES.has(role)) fail('unknown semantic role.');
    const tableGrid = role === 'Table' ? {} : inheritedGrid;
    const pageHint = element.get(NAME('Pg'));
    if (pageHint !== undefined && (role !== 'Figure' || !(pageHint instanceof PDFRef))) fail('figure page context is invalid.');
    const markedPages = new Set<string>();
    const permittedParents = REQUIRED_PARENTS[role];
    if (permittedParents && !permittedParents.includes(parentRole ?? '')) fail('list or table role has an invalid semantic parent.');
    if (/^H[1-6]$/.test(role)) {
      const level = Number(role.slice(1));
      if (level > headingLevel + 1) fail('logical heading levels skip an ancestor.');
      headingLevel = level;
    }
    if (role === 'Figure') {
      const alt = element.lookup(NAME('Alt'));
      if (!(alt instanceof PDFString || alt instanceof PDFHexString) || !alt.decodeText().trim()) fail('figure alternative text is missing.');
      figures++;
    }
    if (role === 'TH') {
      const attributes = element.lookup(NAME('A'), PDFDict);
      if (attributes.lookup(NAME('O'), PDFName) !== NAME('Table')
        || attributes.lookup(NAME('Scope'), PDFName) !== NAME('Column')) fail('table column header scope is missing.');
      headers++;
    }
    const children = element.lookup(NAME('K'), PDFArray);
    let structureChildren = 0; let markedChildren = 0; let objectChildren = 0;
    const tableChildren: string[] = [];
    const linkPages = new Set<string>();
    if (!children.size() && role !== 'TD') fail('non-data structure element is empty.');
    for (const child of children.asArray()) {
      const object = context.lookup(child, PDFDict);
      if (object.lookup(NAME('Type'), PDFName) === NAME('StructElem')) {
        if (!(child instanceof PDFRef)) fail('structure children must be indirect objects.');
        const childRole = object.lookup(NAME('S'), PDFName).decodeText();
        const allowedChildren = ALLOWED_CHILDREN[role];
        if (!CONTAINERS.has(role) || (allowedChildren && !allowedChildren.includes(childRole))) fail('semantic container has an invalid child role.');
        if (role === 'TR' && ((parentRole === 'THead' && childRole !== 'TH') || (parentRole === 'TBody' && childRole !== 'TD'))) {
          fail('table cell role does not match its row group.');
        }
        if (role === 'Table') tableChildren.push(childRole);
        structureChildren++;
        walk(child, ref, depth + 1, role, tableGrid);
      } else if (object.lookup(NAME('Type'), PDFName) === NAME('OBJR')) {
        const obj = object.get(NAME('Obj'));
        const annotation = obj instanceof PDFRef ? annotations.get(obj.toString()) : undefined;
        if (role !== 'Link' || !annotation || usedAnnotations.has(annotation.ref.toString())
          || object.get(NAME('Pg'))?.toString() !== pages[annotation.pageIndex].ref.toString()
          || parentNumbers.lookup(annotation.key * 2, PDFNumber).asNumber() !== annotation.key
          || parentNumbers.get(annotation.key * 2 + 1)?.toString() !== ref.toString()) fail('link object reference has no unique annotation backlink.');
        const alternative = element.lookup(NAME('Alt'));
        const description = annotation.annotation.lookup(NAME('Contents'));
        if (!(alternative instanceof PDFString || alternative instanceof PDFHexString) || !alternative.decodeText().trim()
          || !(description instanceof PDFString || description instanceof PDFHexString) || description.decodeText() !== alternative.decodeText()) fail('link description differs from its logical alternative.');
        usedAnnotations.add(annotation.ref.toString());
        linkPages.add(pages[annotation.pageIndex].ref.toString());
        objectChildren++;
      } else {
        markedChildren++;
        if (object.lookup(NAME('Type'), PDFName) !== NAME('MCR')) fail('structure child is neither an element nor a content reference.');
        const pageRef = object.get(NAME('Pg'));
        const pageIndex = pages.findIndex(page => page.ref.toString() === pageRef?.toString());
        const mcid = object.lookup(NAME('MCID'), PDFNumber).asNumber();
        if (expected.size >= 50_000) fail('content reference count exceeds the generated format limit.');
        const key = `${pageIndex}:${mcid}`;
        if (pageIndex < 0 || !Number.isSafeInteger(mcid) || mcid < 0 || expected.has(key)
          || parentArrays[pageIndex].get(mcid)?.toString() !== ref.toString()) fail('content reference has no unique matching parent-tree backlink.');
        markedPages.add(pages[pageIndex].ref.toString());
        expected.set(key, ref);
      }
    }
    if (role === 'Link' && (!markedChildren || !objectChildren || linkPages.size !== markedPages.size || [...linkPages].some(page => !markedPages.has(page)))) fail('link annotations do not cover their marked text pages.');
    if (role === 'Table' && (tableChildren.length !== 2 || tableChildren[0] !== 'THead' || tableChildren[1] !== 'TBody')) {
      fail('table header and body groups are out of order or incomplete.');
    }
    if (TABLE_CONTAINERS.has(role) && markedChildren) fail('a table container cannot directly hold painted content.');
    if (role === 'TR' && tableGrid) {
      if (tableGrid.columns !== undefined && structureChildren !== tableGrid.columns) fail('table rows disagree on the number of cells.');
      tableGrid.columns = structureChildren;
    }
    if (structureChildren && markedChildren) fail('generated container mixes child elements with direct painted content.');
    if (pageHint && (markedPages.size !== 1 || !markedPages.has(pageHint.toString()))) fail('figure page context does not match its marked content.');
  };
  const roots = tree.lookup(NAME('K'), PDFArray);
  if (roots.size() !== 1 || !(roots.get(0) instanceof PDFRef)) fail('expected one document structure.');
  const documentRef = roots.get(0) as PDFRef;
  if (context.lookup(documentRef, PDFDict).lookup(NAME('S'), PDFName) !== NAME('Document')) fail('root element is not a document.');
  walk(documentRef, rootRef, 0);
  if (usedAnnotations.size !== annotations.size) fail('an annotation is missing from the structure tree.');
  if (tree.lookup(NAME('ParentTreeNextKey'), PDFNumber).asNumber() !== pages.length + annotations.size) fail('next parent-tree key is invalid.');
  let decoded = 0; let associated = 0; let artifacts = 0; let painted = 0;
  for (const [pageIndex, page] of pages.entries()) {
    const contents = page.node.Contents();
    const entries = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    if (!entries.length || entries.length > 64) fail('page content stream count is invalid.');
    const pieces = entries.map(entry => {
      const stream = context.lookup(entry);
      if (!(stream instanceof PDFRawStream) || stream.dict.has(NAME('DecodeParms'))) fail('unsupported generated content stream.');
      const filter = stream.dict.get(NAME('Filter'));
      if (filter && filter !== NAME('FlateDecode')) fail('unsupported generated content filter.');
      const bytes = filter ? inflateBounded(stream.contents, MAX_BYTES - decoded) : stream.contents;
      decoded += bytes.length; if (decoded > MAX_BYTES) fail('decoded content exceeds 32 MiB.');
      return byteString(bytes);
    });
    let open: 'artifact' | number | undefined; let count = 0; let openPainted = false;
    for (const operation of readPdfContent(pieces.join('\n'))) {
      if (operation.operator === 'BDC') {
        const [role, properties] = operation.operands;
        const values = properties?.children;
        if (open !== undefined || role?.kind !== 'name' || properties?.kind !== 'dictionary' || values?.length !== 2
          || values[0].kind !== 'name' || values[0].value !== 'MCID' || values[1].kind !== 'number' || values[1].value !== count) fail('invalid, nested or noncontiguous marked content.');
        const owner = expected.get(`${pageIndex}:${count}`);
        if (!owner || context.lookup(owner, PDFDict).lookup(NAME('S'), PDFName).decodeText() !== role.value) fail('painted content does not match its semantic owner.');
        open = count++; associated++; openPainted = false;
      } else if (operation.operator === 'BMC') {
        if (open !== undefined || operation.operands.length !== 1 || operation.operands[0].kind !== 'name' || operation.operands[0].value !== 'Artifact') fail('invalid artifact scope.');
        open = 'artifact'; artifacts++; openPainted = false;
      } else if (operation.operator === 'EMC') {
        if (open === undefined || operation.operands.length) fail('unbalanced marked content boundary.');
        if (typeof open === 'number' && !openPainted) fail('associated marked content has no painted operation.');
        open = undefined;
      } else if (operation.operator === 'DP' || operation.operator === 'MP') fail('unfinished or unsupported marked content point.');
      else if (PAINT.has(operation.operator)) { if (open === undefined) fail('painted content is outside structure and artifact scopes.'); painted++; openPainted = true; }
    }
    if (open !== undefined || count !== parentArrays[pageIndex].size()) fail('page boundaries or parent-tree array do not match its marked content.');
  }
  if (!painted || associated !== expected.size) fail('forward references do not match the actual marked content.');
  return { kind: 'generated-structure-check', pages: pages.length, structureElements: elements, associatedChunks: associated, artifactChunks: artifacts,
    paintedOperations: painted, figures, columnHeaders: headers, conformance: 'PDF/UA not established' };
}
