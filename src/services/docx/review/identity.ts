import JSZip from 'jszip';
import { z } from 'zod';
import { reviewDigestSchema, reviewRoundIdSchema } from '@/lib/reviewRounds';
import { isWord, readWordArchive, wordAttribute, wordChildren, wordDescendants, wordXml, xmlChildren, WORD_IMPORT_LIMITS } from '../import/archive';

const NAMESPACE = 'urn:dondocs:word-review:1';
const PART = 'customXml/dondocs-word-review.xml';
const RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const BOOKMARK_PREFIX = 'DDReview_';
const MAX_BINDINGS = 1_000;
const MAX_BOOKMARK_ID = 2_147_483_647;
const locatorSchema = z.object({ handoffId: z.string().uuid(), roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema }).strict();
export type WordReviewLocator = z.infer<typeof locatorSchema>;
export interface WordReviewMarker { ordinal: number; sourceIndex: number }
export interface WordReviewIdentity { locator: WordReviewLocator; markers: WordReviewMarker[] }

function ownBytes(input: Uint8Array): Uint8Array {
  if (!input.byteLength || input.byteLength > WORD_IMPORT_LIMITS.compressedBytes) throw new Error('Word review files must be smaller than 20 MB.');
  return Uint8Array.from(input);
}
function check(signal?: AbortSignal): void { signal?.throwIfAborted(); }
function serialize(document: Document): string { return new XMLSerializer().serializeToString(document); }
function bodyOf(document: Document): Element {
  if (!isWord(document.documentElement, 'document')) throw new Error('The Word review main document is unsupported.');
  const body = wordChildren(document.documentElement, 'body');
  if (body.length !== 1) throw new Error('The Word review body is missing or ambiguous.');
  return body[0];
}
function bookmarkPairs(body: Element): Map<number, { start: Element; end: Element }> {
  const starts = new Map<number, { element: Element; position: number }>(), ends = new Map<number, { element: Element; position: number }>();
  const elements = Array.from(body.getElementsByTagName('*')).filter(element => isWord(element, 'bookmarkStart') || isWord(element, 'bookmarkEnd'));
  for (const [position, element] of elements.entries()) {
    const raw = wordAttribute(element, 'id'), id = Number(raw);
    if (raw === null || !/^[+-]?\d{1,10}$/.test(raw) || !Number.isInteger(id) || id < -2_147_483_648 || id > MAX_BOOKMARK_ID) throw new Error('The Word bookmark identities must be valid decimal integers.');
    const map = isWord(element, 'bookmarkStart') ? starts : ends;
    if (map.has(id)) throw new Error('The Word bookmark identities are duplicated or ambiguous.');
    map.set(id, { element, position });
  }
  if (starts.size !== ends.size) throw new Error('The Word bookmark pairs are incomplete.');
  const pairs = new Map<number, { start: Element; end: Element }>();
  for (const [id, start] of starts) {
    const end = ends.get(id);
    if (!end || start.position >= end.position) throw new Error('The Word bookmark pair is missing or ends before its start.');
    pairs.set(id, { start: start.element, end: end.element });
  }
  return pairs;
}
function relationshipDocument(archive: Map<string, Uint8Array>): Document {
  const document = wordXml(archive.get('word/_rels/document.xml.rels'), 'relationships');
  if (document.documentElement.namespaceURI !== PACKAGE_REL || document.documentElement.localName !== 'Relationships') throw new Error('The Word review relationship namespace is unsupported.');
  return document;
}
function locatorXml(locator: WordReviewLocator): string {
  // All values are constrained UUID/review IDs or hexadecimal digests.
  return `<?xml version="1.0" encoding="UTF-8"?><review xmlns="${NAMESPACE}" version="1" handoffId="${locator.handoffId}" roundId="${locator.roundId}" baselineDigest="${locator.baselineDigest}"/>`;
}

/** Add only editable matching evidence to an already approved Word derivative.
 * The local native review round and its retained issued receipt own authority.
 */
export async function stampWordReviewIdentity(input: Uint8Array, locatorInput: WordReviewLocator, sourceIndexes: readonly number[], signal?: AbortSignal): Promise<Uint8Array> {
  const locator = locatorSchema.parse(locatorInput), indexes = [...sourceIndexes];
  if (!indexes.length || indexes.length > MAX_BINDINGS || indexes.some((value, index) => !Number.isSafeInteger(value) || value < 0 || index > 0 && value <= indexes[index - 1])) throw new Error('Word review paragraph bindings must be unique and in document order.');
  const bytes = ownBytes(input); check(signal);
  const archive = await readWordArchive(bytes, signal); check(signal);
  if (archive.has(PART)) throw new Error('This Word output already carries a review identity. Prepare a new copy from the retained baseline.');
  const document = wordXml(archive.get('word/document.xml'), 'document'), body = bodyOf(document), blocks = xmlChildren(body);
  const existingBookmarks = wordDescendants(body, 'bookmarkStart');
  if (existingBookmarks.some(bookmark => (wordAttribute(bookmark, 'name') ?? '').startsWith(BOOKMARK_PREFIX))) throw new Error('This Word output already contains review paragraph markers.');
  const pairs = bookmarkPairs(body);
  let nextId = 1;
  for (const id of pairs.keys()) nextId = Math.max(nextId, id + 1);
  if (nextId > MAX_BOOKMARK_ID - indexes.length + 1) throw new Error('The Word bookmark identity range is exhausted. Prepare a new Word review copy.');
  for (const [ordinal, sourceIndex] of indexes.entries()) {
    const paragraph = blocks[sourceIndex];
    if (!paragraph || !isWord(paragraph, 'p')) throw new Error('The approved Word paragraph binding no longer matches its source.');
    const namespace = paragraph.namespaceURI!, id = String(nextId++);
    const start = document.createElementNS(namespace, 'w:bookmarkStart'), end = document.createElementNS(namespace, 'w:bookmarkEnd');
    start.setAttributeNS(namespace, 'w:id', id); start.setAttributeNS(namespace, 'w:name', `${BOOKMARK_PREFIX}${ordinal}`); end.setAttributeNS(namespace, 'w:id', id);
    const properties = wordChildren(paragraph, 'pPr')[0];
    paragraph.insertBefore(start, properties ? properties.nextSibling : paragraph.firstChild); paragraph.appendChild(end);
  }
  const rels = relationshipDocument(archive), relationId = 'dondocsWordReview';
  if (xmlChildren(rels.documentElement).some(element => element.getAttribute('Id') === relationId || element.getAttribute('Target') === `../${PART}`)) throw new Error('The Word review relationship is ambiguous.');
  const relation = rels.createElementNS(PACKAGE_REL, 'Relationship');
  for (const [name, value] of Object.entries({ Id: relationId, Type: RELATIONSHIP, Target: `../${PART}` })) relation.setAttribute(name, value);
  rels.documentElement.appendChild(relation);
  const types = wordXml(archive.get('[Content_Types].xml'), 'content types');
  if (types.documentElement.namespaceURI !== CONTENT_TYPES || types.documentElement.localName !== 'Types') throw new Error('The Word content-type namespace is unsupported.');
  if (xmlChildren(types.documentElement).some(element => element.getAttribute('PartName') === `/${PART}`)) throw new Error('The Word review part is ambiguous.');
  const override = types.createElementNS(CONTENT_TYPES, 'Override'); override.setAttribute('PartName', `/${PART}`); override.setAttribute('ContentType', 'application/xml'); types.documentElement.appendChild(override);
  const zip = await JSZip.loadAsync(bytes); check(signal);
  if (Object.keys(zip.files).some(name => name.toLowerCase() === PART.toLowerCase())) throw new Error('This Word output already carries a review identity part.');
  zip.file(PART, locatorXml(locator)); zip.file('word/document.xml', serialize(document)); zip.file('word/_rels/document.xml.rels', serialize(rels)); zip.file('[Content_Types].xml', serialize(types));
  const output = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }); check(signal);
  if (output.byteLength > WORD_IMPORT_LIMITS.compressedBytes) throw new Error('The prepared Word review copy exceeds 20 MB.');
  return output;
}

/** Returned locators and bookmark positions are untrusted evidence. Callers
 * must match every item to an authoritative local issued receipt and owner.
 */
export async function readWordReviewIdentity(input: Uint8Array, signal?: AbortSignal): Promise<WordReviewIdentity> {
  const bytes = ownBytes(input); check(signal);
  const archive = await readWordArchive(bytes, signal); check(signal);
  const rels = relationshipDocument(archive);
  const candidates: Array<{ part: string; document: Document }> = [];
  for (const relation of xmlChildren(rels.documentElement)) {
    if (relation.namespaceURI !== PACKAGE_REL || relation.localName !== 'Relationship' || relation.getAttribute('Type') !== RELATIONSHIP) continue;
    if (relation.getAttribute('TargetMode') && relation.getAttribute('TargetMode') !== 'Internal') continue;
    const target = relation.getAttribute('Target') ?? '';
    const url = new URL(target, 'https://word.invalid/word/');
    if (url.origin !== 'https://word.invalid' || url.search || url.hash) continue;
    const part = decodeURIComponent(url.pathname).slice(1);
    const data = archive.get(part);
    if (!data || !/\.xml$/i.test(part)) continue;
    const document = wordXml(data, 'custom XML');
    if (document.documentElement.namespaceURI === NAMESPACE) candidates.push({ part, document });
  }
  if (candidates.length !== 1) throw new Error('This Word file has no single intact DonDocs review identity. Keep it for manual review or import it as a separate draft.');
  const candidate = candidates[0], root = candidate.document.documentElement;
  if (root.localName !== 'review' || root.getAttribute('version') !== '1' || xmlChildren(root).length || root.textContent?.trim()
    || Array.from(root.attributes).some(attribute => attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !['version', 'handoffId', 'roundId', 'baselineDigest'].includes(attribute.name))) throw new Error('This Word review identity is unsupported or modified.');
  const types = wordXml(archive.get('[Content_Types].xml'), 'content types');
  if (types.documentElement.namespaceURI !== CONTENT_TYPES || types.documentElement.localName !== 'Types') throw new Error('The Word content-type namespace is unsupported.');
  const overrides = xmlChildren(types.documentElement).filter(element => element.namespaceURI === CONTENT_TYPES && element.localName === 'Override' && element.getAttribute('PartName') === `/${candidate.part}`);
  const defaults = xmlChildren(types.documentElement).filter(element => element.namespaceURI === CONTENT_TYPES && element.localName === 'Default' && element.getAttribute('Extension')?.toLowerCase() === 'xml');
  if (overrides.length > 1 || (!overrides.length && defaults.length !== 1) || (overrides[0] ?? defaults[0]).getAttribute('ContentType') !== 'application/xml') throw new Error('The Word review identity content type is missing or inconsistent.');
  const locator = locatorSchema.parse({ handoffId: root.getAttribute('handoffId'), roundId: root.getAttribute('roundId'), baselineDigest: root.getAttribute('baselineDigest') });
  const body = bodyOf(wordXml(archive.get('word/document.xml'), 'document')), markers: WordReviewMarker[] = [], seen = new Set<number>();
  const pairs = bookmarkPairs(body);
  for (const [sourceIndex, paragraph] of xmlChildren(body).entries()) {
    let paragraphMarkers = 0;
    for (const bookmark of wordDescendants(paragraph, 'bookmarkStart')) {
      const name = wordAttribute(bookmark, 'name') ?? '';
      if (!name.startsWith(BOOKMARK_PREFIX)) continue;
      const suffix = name.slice(BOOKMARK_PREFIX.length), ordinal = Number(suffix), id = wordAttribute(bookmark, 'id');
      if (!isWord(paragraph, 'p') || !/^(0|[1-9]\d{0,3})$/.test(suffix) || ordinal >= MAX_BINDINGS || seen.has(ordinal) || id === null || ++paragraphMarkers > 1
        || !wordDescendants(paragraph, 'bookmarkEnd').includes(pairs.get(Number(id))!.end)) throw new Error('Word review paragraph markers are missing, duplicated or ambiguous.');
      seen.add(ordinal); markers.push({ ordinal, sourceIndex });
    }
  }
  if (!markers.length || markers.some((marker, index) => marker.ordinal !== index)) throw new Error('Word review paragraph markers are incomplete or out of order. Keep the file for manual review.');
  return { locator, markers };
}
