import { retainedWordText } from './retainedText';
import { assertSupportedWordImage } from './imageSupport';
import { readWordComments, type WordComment } from './readComments';
import { inspectRasterImage } from '../imageAssets';
import { bodyTableSchema } from '@/lib/bodyTable';
import type { Paragraph } from '@/types/document';
import { newParagraphId } from '@/lib/paragraphIdentity';
import { projectWordBody, type WordHeaderFields } from './projectWordBody';
import { isWord, readWordArchive, wordAttribute, wordChildren, wordDescendants, wordXml, xmlChildren, WORD_IMPORT_LIMITS, WORD_NAMESPACES, WORD_REL_NAMESPACES } from './archive';

const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DRAWING = new Set(['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main']);
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export interface WordBlock { paragraph: Paragraph; plainText: string; wordId?: string; sourceIndex: number; numbered?: boolean; nativeTextOffset?: number; tablePlainRows?: string[][] }
export interface WordSource { name: string; bytes: Uint8Array; sha256: string; retainedText: string }
export interface WordImport { comments: WordComment[]; blocks: WordBlock[]; sourceBlocks: WordBlock[]; headerFields: WordHeaderFields; plainText: string; markings: string; notices: string[]; source: WordSource }

function assertLiteralText(text: string): void {
  // The native editor has no lossless escape for these paired markers. Reject
  // source literals rather than turning visible Word characters into styling.
  if (/\*\*(.+?)\*\*|(?<!\*)\*([^*]+)\*(?!\*)|__([^_]+?)__|\\(?:textbf|textit|underline)\{[^{}]*\}/.test(text)) {
    throw new Error('This Word file contains literal formatting markers such as **text**, *text* or __text__. Import is paused because the native editor would change those visible characters. Keep the original Word file and revise those literals before importing.');
  }
}

interface TextSpan { text: string; mark?: string }

function paragraphText(element: Element, view: 'before' | 'after', formatted: boolean, notice: (text: string) => void, preserveNoBreakHyphens = true): string {
  if (formatted && isWord(element, 'p')) assertLiteralText(paragraphText(element, view, false, notice));
  const spans: TextSpan[] = [];
  const append = (text: string, mark?: string) => {
    if (!text) return;
    const previous = spans.at(-1);
    if (previous && previous.mark === mark) previous.text += text;
    else spans.push({ text, ...(mark ? { mark } : {}) });
  };
  const walk = (node: Element, inheritedMark?: string): void => {
    if ((isWord(node, 'ins') || isWord(node, 'moveTo')) && view === 'before'
      || (isWord(node, 'del') || isWord(node, 'moveFrom')) && view === 'after') return;
    if (isWord(node, 't') || isWord(node, 'delText')) { append(node.textContent ?? '', inheritedMark); return; }
    if (isWord(node, 'noBreakHyphen')) { if (preserveNoBreakHyphens) append('\u2011', inheritedMark); return; }
    if (isWord(node, 'tab')) { append('\t', inheritedMark); return; }
    if (isWord(node, 'br') || isWord(node, 'cr')) { append('\n', inheritedMark); return; }
    if (['pPr', 'rPr', 'drawing', 'pict'].some(name => isWord(node, name))) return;
    let mark = inheritedMark;
    if (formatted && isWord(node, 'r')) {
      const properties = wordChildren(node, 'rPr')[0];
      const enabled = (name: string) => properties && wordChildren(properties, name).some(property => !['0', 'false', 'none', 'off'].includes(wordAttribute(property, 'val') ?? 'true'));
      const marks = [enabled('b') && '**', enabled('i') && '*', enabled('u') && '__'].filter((value): value is string => typeof value === 'string');
      if (marks.length > 1) notice('Combined inline styles are normalized to one native emphasis style; the original Word file retains the complete formatting.');
      mark = marks[0];
      const text = paragraphText(node, view, false, notice);
      if (!text.trim() || /[*_\n]/.test(text)) {
        if (mark && text.trim()) notice('Emphasis containing special formatting characters is imported as plain text.');
        mark = undefined;
      }
    }
    for (const child of wordChildren(node)) walk(child, mark);
  };
  walk(element);
  // Word often splits a styled word into several runs (including revision
  // boundaries). Serialize equal adjacent styles once so native emphasis never
  // turns into ambiguous *one**two* marker sequences.
  return spans.map(({ text, mark }) => {
    if (!mark) return text;
    const [, leading, content, trailing] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
    return `${leading}${mark}${content}${mark}${trailing}`;
  }).join('');
}

/** Select the same revision view for media as for its surrounding text. */
function baselineDrawings(paragraph: Element): Element[] {
  return wordDescendants(paragraph, 'drawing').filter(drawing => {
    let ancestor = drawing.parentNode;
    while (ancestor && ancestor !== paragraph) {
      if (ancestor.nodeType === 1 && (isWord(ancestor as Element, 'ins') || isWord(ancestor as Element, 'moveTo'))) return false;
      ancestor = ancestor.parentNode;
    }
    return true;
  });
}

function resolveRelationship(target: string, packageXml = false): string {
  // eslint-disable-next-line no-control-regex -- Reject controls in untrusted Word paths and filenames.
  if (!target || /[\\\u0000-\u001f]/.test(target)) throw new Error('Invalid Word relationship target.');
  const url = new URL(target, 'https://word.invalid/word/');
  const path = decodeURIComponent(url.pathname).slice(1);
  if (url.origin !== 'https://word.invalid' || url.search || url.hash || (!packageXml && !path.startsWith('word/') || packageXml && !/\.xml$/i.test(path)) || path.split('/').some(part => part === '.' || part === '..') || path.includes('\\')) throw new Error('Word relationships must refer to supported files inside the document package.');
  return path;
}

/** Read only bounded package-owned XML and raster media. No remote relationship is fetched. */
async function readWord(input: Uint8Array, name: string, signal: AbortSignal | undefined, importComments: boolean, legacyInventory = false): Promise<WordImport> {
  if (input.byteLength > WORD_IMPORT_LIMITS.compressedBytes) throw new Error('Word files must be smaller than 20 MB.');
  // eslint-disable-next-line no-control-regex -- Reject controls in untrusted Word paths and filenames.
  if (!name.trim() || name.length > 255 || /[\u0000-\u001f]/.test(name)) throw new Error('Choose a Word file with a valid filename of at most 255 characters.');
  signal?.throwIfAborted();
  const bytes = new Uint8Array(input);
  const archive = await readWordArchive(bytes, signal);
  signal?.throwIfAborted();
  const types = wordXml(archive.get('[Content_Types].xml'), 'content types');
  const contentNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
  if (types.documentElement.namespaceURI !== contentNamespace || types.documentElement.localName !== 'Types'
    || !xmlChildren(types.documentElement).some(element => element.namespaceURI === contentNamespace && element.localName === 'Override' && element.getAttribute('PartName') === '/word/document.xml' && element.getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) throw new Error('This archive is not a supported .docx Word document.');
  const packageRels = wordXml(archive.get('_rels/.rels'), 'package relationships');
  const main = xmlChildren(packageRels.documentElement).filter(element => element.namespaceURI === PACKAGE_REL && element.localName === 'Relationship' && [...WORD_REL_NAMESPACES].some(namespace => element.getAttribute('Type') === `${namespace}/officeDocument`));
  if (packageRels.documentElement.namespaceURI !== PACKAGE_REL || packageRels.documentElement.localName !== 'Relationships' || main.length !== 1 || main[0].getAttribute('Target')?.replace(/^\//, '') !== 'word/document.xml' || main[0].getAttribute('TargetMode') === 'External') throw new Error('This Word file has an unsupported main-document relationship.');
  const document = wordXml(archive.get('word/document.xml'), 'document');
  if (!isWord(document.documentElement, 'document')) throw new Error('This file does not contain a supported Word document namespace.');
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    if (['document', 'body', 'p', 'r', 't', 'delText', 'tbl', 'tr', 'tc', 'ins', 'del', 'commentRangeStart', 'commentRangeEnd', 'commentReference'].includes(element.localName) && !WORD_NAMESPACES.has(element.namespaceURI ?? '')) throw new Error('Word content uses an unsupported XML namespace.');
  }
  const body = wordChildren(document.documentElement, 'body')[0];
  if (!body) throw new Error('The Word document has no body.');
  const notices = new Set<string>();
  const notice = (text: string) => { if (notices.size < 30) notices.add(text); };
  const relationships = new Map<string, { target: string; type: string; external: boolean }>();
  if (archive.has('word/_rels/document.xml.rels')) {
    const rels = wordXml(archive.get('word/_rels/document.xml.rels'), 'relationships');
    if (rels.documentElement.namespaceURI !== PACKAGE_REL || rels.documentElement.localName !== 'Relationships') throw new Error('Unsupported Word relationships namespace.');
    for (const relation of xmlChildren(rels.documentElement)) {
      if (relation.namespaceURI !== PACKAGE_REL || relation.localName !== 'Relationship') throw new Error('Invalid Word relationship.');
      const id = relation.getAttribute('Id') ?? '', target = relation.getAttribute('Target') ?? '', type = relation.getAttribute('Type') ?? '';
      if (!id || relationships.has(id)) throw new Error('Word relationships must have unique IDs.');
      relationships.set(id, { target, type, external: relation.getAttribute('TargetMode') === 'External' });
    }
  }
  // Headers may legally live outside word/. Inventory their actual package-
  // owned XML as well; an external/non-XML header cannot be assessed offline.
  for (const relation of relationships.values()) {
    const kind = [...WORD_REL_NAMESPACES].flatMap(namespace => ['header', 'footer'].filter(name => relation.type === `${namespace}/${name}`))[0];
    if (!kind) continue;
    if (relation.external) throw new Error('External Word headers or footers cannot be imported offline.');
    const part = wordXml(archive.get(resolveRelationship(relation.target, true)), kind);
    if (!isWord(part.documentElement, kind === 'header' ? 'hdr' : 'ftr')) throw new Error('Unsupported Word header or footer XML.');
  }
  const blocks: WordBlock[] = []; let imageCount = 0, textCharacters = 0, imagePixels = 0, previousLevel = -1, headingLevel = 0;
  const imageBytes = new Map<string, { path: string; bytes: Uint8Array }>();
  const inspectedImages = new Map<string, { width: number; height: number }>();
  let retainedResourceBytes = bytes.byteLength;
  const append = (paragraph: Paragraph, plainText: string, sourceIndex: number, wordId?: string) => {
    textCharacters += plainText.length;
    if (blocks.length >= WORD_IMPORT_LIMITS.paragraphs || textCharacters > WORD_IMPORT_LIMITS.text) throw new Error('This Word document has too much editable content.');
    blocks.push({ paragraph: { ...paragraph, id: newParagraphId() }, plainText, sourceIndex, ...(wordId ? { wordId } : {}) });
  };
  for (const [sourceIndex, element] of xmlChildren(body).entries()) {
    signal?.throwIfAborted();
    if (isWord(element, 'p')) {
      const plain = paragraphText(element, 'before', false, notice), text = paragraphText(element, 'before', true, notice);
      const properties = wordChildren(element, 'pPr')[0];
      const style = properties && wordChildren(properties, 'pStyle')[0];
      const headingMatch = style && /^Heading([1-6])$/i.exec(wordAttribute(style, 'val') ?? '');
      const heading = !!headingMatch;
      const numPr = properties && wordChildren(properties, 'numPr')[0];
      const ilvl = numPr && wordChildren(numPr, 'ilvl')[0];
      const rawLevel = headingMatch ? Number(headingMatch[1]) - 1 : numPr ? (ilvl ? Number(wordAttribute(ilvl, 'val')) : 0) : headingLevel;
      if (!Number.isInteger(rawLevel) || rawLevel < 0 || rawLevel > 7) throw new Error('Word list indentation exceeds the supported seven nested levels.');
      const level = Math.min(rawLevel, previousLevel + 1);
      if (level !== rawLevel) notice('Skipped heading or list levels are reduced to a consecutive native hierarchy.');
      previousLevel = level;
      if (heading) headingLevel = level;
      if (style && !heading && !/^(Normal|BodyText|ListParagraph)$/i.test(wordAttribute(style, 'val') ?? '')) notice('Custom paragraph styles use native document formatting; the original file retains their full styling.');
      const wordId = element.getAttributeNS('http://schemas.microsoft.com/office/word/2010/wordml', 'paraId') ?? undefined;
      const drawings = baselineDrawings(element);
      if (text || !drawings.length) {
        append({ text: heading ? '' : text, level, ...(heading ? { header: plain } : {}) }, plain, sourceIndex, wordId);
        if (numPr) blocks.at(-1)!.numbered = true;
      }
      if (drawings.length) notice('Images become separate native body blocks after their source paragraph; floating positions and inline wrapping are not retained.');
      for (const drawing of drawings) {
        const blips = Array.from(drawing.getElementsByTagName('*')).filter(item => item.localName === 'blip' && DRAWING.has(item.namespaceURI ?? ''));
        if (!blips.length) { notice('A drawing without an embedded PNG or JPEG remains in the original Word file.'); continue; }
        for (const blip of blips) {
          let id: string | null = null;
          for (const namespace of WORD_REL_NAMESPACES) id ??= blip.getAttributeNS(namespace, 'embed');
          const relation = id && relationships.get(id);
          if (!relation || relation.external || ![...WORD_REL_NAMESPACES].some(namespace => relation.type === `${namespace}/image`)) { notice('Linked or unsupported images remain in the original file; no external image was fetched.'); continue; }
          const path = resolveRelationship(relation.target), data = archive.get(path);
          const type = /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : null;
          if (!type) { notice('Only embedded PNG and JPEG images are imported. Other image formats remain in the original Word file.'); continue; }
          if (!data) throw new Error('An embedded Word image is missing.');
          assertSupportedWordImage(drawing);
          if (++imageCount > WORD_IMPORT_LIMITS.images) throw new Error('This Word document has too many images.');
          let dimensions = inspectedImages.get(path);
          if (!dimensions) {
            retainedResourceBytes += data.byteLength;
            if (retainedResourceBytes > 64 * 1024 * 1024) throw new Error('The original Word file and its unique images exceed the 64 MB import resource limit.');
            dimensions = await inspectRasterImage(data, type);
            inspectedImages.set(path, dimensions);
          }
          imagePixels += dimensions.width * dimensions.height;
          if (imagePixels > 80_000_000) throw new Error('Word images exceed the combined 80 megapixel import limit.');
          signal?.throwIfAborted();
          const alt = Array.from(drawing.getElementsByTagName('*')).find(item => item.localName === 'docPr' && item.namespaceURI === 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing');
          const caption = alt?.getAttribute('title') || '';
          assertLiteralText(caption);
          const description = alt?.getAttribute('descr');
          if (description && description.length > 2_000) notice('Image alternative text longer than 2,000 characters is shortened; the complete description remains in the original file.');
          const altText = description?.slice(0, 2_000);
          append({ text: caption, level: 0, figure: { name: path.split('/').at(-1)!, type, width: dimensions.width, height: dimensions.height, placement: 'body', ...(altText ? { altText } : {}) } }, caption, sourceIndex);
          imageBytes.set(blocks.at(-1)!.paragraph.id!, { path, bytes: data });
        }
      }
    } else if (isWord(element, 'tbl')) {
      if (wordDescendants(element, 'drawing').length || wordDescendants(element, 'pict').length) notice('Images inside table cells remain in the original Word file; only table-cell text is imported.');
      if (wordDescendants(element, 'gridSpan').length || wordDescendants(element, 'vMerge').length || wordDescendants(element, 'tbl').length) {
        notice('Merged or nested tables are imported as readable text; the original Word file retains their layout.');
        const plainTable = wordDescendants(element, 'p').map(p => paragraphText(p, 'before', false, notice)).join('\n');
        assertLiteralText(plainTable);
        append({ text: plainTable, level: 0 }, element.textContent ?? '', sourceIndex);
        continue;
      }
      const rows = wordChildren(element, 'tr');
      const cells = rows.map(row => wordChildren(row, 'tc').map(cell => wordChildren(cell, 'p').map(p => paragraphText(p, 'before', true, notice)).join('\n')));
      let headerRows = 0;
      for (const row of rows) {
        const properties = wordChildren(row, 'trPr')[0], header = properties && wordChildren(properties, 'tblHeader')[0];
        if (header && !['0', 'false', 'off'].includes(wordAttribute(header, 'val') ?? '') && headerRows < 3) headerRows++; else break;
      }
      const table = bodyTableSchema.parse({ rows: cells, headerRows });
      const plainRows = rows.map(row => wordChildren(row, 'tc').map(cell => wordChildren(cell, 'p').map(p => paragraphText(p, 'before', false, notice)).join('\n')));
      append({ text: '', level: 0, bodyTable: table }, plainRows.map(row => row.join('\t')).join('\n'), sourceIndex);
      blocks.at(-1)!.tablePlainRows = plainRows;
    } else if (!isWord(element, 'sectPr')) {
      notice('Some body objects are not editable in DonDocs and remain in the original Word file.');
    }
  }
  if (['ins', 'del', 'moveTo', 'moveFrom'].some(name => wordDescendants(body, name).length)) notice('This draft shows content before Word tracked changes. Proposed image changes remain in the original Word file; review them there.');
  const commentRelations = [...relationships.values()].filter(relation => [...WORD_REL_NAMESPACES].some(namespace => relation.type === `${namespace}/comments`));
  if (commentRelations.length > 1) throw new Error('Word comments have ambiguous relationships.');
  const relation = commentRelations[0];
  let comments: WordComment[] = [];
  if (relation && !relation.external) {
    const data = archive.get(resolveRelationship(relation.target));
    if (!data) throw new Error('The Word comments part is missing.');
    if (importComments) comments = readWordComments(data, body, notice);
    if (comments.length) notice('Word reply threading, resolved flags, mentions and comment formatting remain in the original file. Imported entries are independent open discussions.');
    if (comments.length) notice('Word author names and dates are unverified. Exact plain-text selections become native range comments; formatted selections become paragraph discussions with a quoted Word selection.');
  } else if (relation || wordDescendants(body, 'commentRangeStart').length) {
    notice('Word comment text is unavailable through a supported internal relationship. The original file retains these unresolved ranges.');
  }
  if (wordDescendants(body, 'numPr').length) notice('List indentation is normalized to native paragraph levels. Review automatic numbering before exporting.');
  if (wordDescendants(body, 'hyperlink').length || wordDescendants(body, 'bookmarkStart').length) notice('Hyperlink display text is imported; link destinations and Word bookmarks remain in the original file.');
  if (wordDescendants(body, 'pict').length || wordDescendants(body, 'object').length || wordDescendants(body, 'fldChar').length || wordDescendants(body, 'fldSimple').length || wordDescendants(body, 'footnoteReference').length) notice('Fields, legacy drawings, embedded objects and footnotes are not reproduced; keep the original Word file.');
  const retained = retainedWordText(archive, (paragraph, view) => paragraphText(paragraph, view, false, notice, !legacyInventory));
  const retainedText = retained.text;
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  const projection = projectWordBody(blocks, notice);
  const result: WordImport = { comments, blocks: projection.blocks, sourceBlocks: blocks, headerFields: projection.headerFields, plainText: blocks.map(block => block.plainText).join('\n'), markings: retained.markings, notices: [...notices], source: { name, bytes, sha256, retainedText } };
  resources.set(result, imageBytes);
  ownedImports.set(result, structuredClone(result));
  return result;
}
/** New native imports enforce discussion limits. */
export async function readWordDocument(input: Uint8Array, name: string, signal?: AbortSignal): Promise<WordImport> {
  return readWord(input, name, signal, true);
}

/** Recover an already retained original without applying newer native-comment
 * limits. Archive validation and the complete retained-text inventory still run
 * before callers verify its hash or apply the deployment handling policy. */
export async function readRetainedWordSource(input: Uint8Array, name: string, signal?: AbortSignal): Promise<WordSource> {
  return (await readWord(input, name, signal, false)).source;
}

/** Compatibility is restricted to the exact inventory produced before
 * noBreakHyphen tokens were preserved. Literal hyphens and all other retained
 * content still have to match, together with the digest of the actual bytes. */
export async function matchesLegacyWordSourceInventory(input: Uint8Array, name: string, sha256: string, retainedText: string): Promise<boolean> {
  const legacy = (await readWord(input, name, undefined, false, true)).source;
  return legacy.sha256 === sha256 && legacy.retainedText === retainedText;
}

const resources = new WeakMap<WordImport, Map<string, { path: string; bytes: Uint8Array }>>();
const ownedImports = new WeakMap<WordImport, WordImport>();
export function copyWordImport(imported: WordImport): WordImport {
  const owned = ownedImports.get(imported);
  if (!owned) throw new Error('Read this Word file again before importing it.');
  return structuredClone(owned);
}
export function wordImageResourceKey(imported: WordImport, paragraphId: string): string | undefined { return resources.get(imported)?.get(paragraphId)?.path; }
export function wordImageBytes(imported: WordImport, paragraphId: string): Uint8Array | undefined { return resources.get(imported)?.get(paragraphId)?.bytes.slice(); }
export const WORD_DOCUMENT_TYPE = DOCX_TYPE;
