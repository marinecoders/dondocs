import JSZip from 'jszip';
import { additionalProofreadFindings } from '@/lib/correspondenceProofreadChecks';
import { collectProofreadFindings, type ProofreadSource } from '@/lib/proofread';
import { reviewPayloadDigest } from '@/lib/reviewRounds';
import { isWord, readWordArchive, wordAttribute, wordChildren, wordDescendants, wordXml, xmlChildren, WORD_IMPORT_LIMITS, WORD_REL_NAMESPACES } from '../import/archive';
import { WORD_DOCUMENT_TYPE, readWordParagraphText } from '../import/readWord';
import type { WordComment } from '../import/readComments';

const COMMENT_PART = 'word/comments.xml';
const DOCUMENT_PART = 'word/document.xml';
const RELATIONSHIPS_PART = 'word/_rels/document.xml.rels';
const TYPES_PART = '[Content_Types].xml';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const COMMENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';
const BOOKMARK_PREFIX = 'DonDocsProofread';
const AUTHOR = 'DonDocs Proofread';
const MAX_COMMENTS = 100;
const ADVICE = {
  acronyms: 'Spell out the abbreviation on its first use. Review the context before changing it.',
  privacy: 'Review this paragraph for possible sensitive information before sharing the document.',
  references: 'Check the enclosure citation against the enclosure list and confirm its target.',
  structure: 'Review this paragraph’s numbering and heading against the surrounding paragraphs.',
};

/** Suppress only unchanged generated advisory comments on the return path.
 * The exact issued receipt owns these identities. Reviewer edits stay visible. */
export function issuedProofreadCommentDigest(comment: WordComment, format: 'paragraph' | 'legacy' = 'paragraph'): Promise<string> | undefined {
  const { wordId, author, text, selection } = comment;
  if (author !== AUTHOR || !selection || !text.split('\n').every(line => Object.values(ADVICE).includes(line))) return undefined;
  const { sourceIndex, start, end } = selection;
  if (format === 'legacy') return reviewPayloadDigest({ wordId, author, text, sourceIndex, start, end });
  // An edit inside the marked paragraph can change its length while the note
  // still covers the same whole paragraph. A reanchored note stays reviewable.
  if (start !== 0 || end !== selection.context.length) return undefined;
  return reviewPayloadDigest({ wordId, author, text, sourceIndex, range: 'whole-paragraph' });
}

export function planWordProofreadComments(source: ProofreadSource) {
  const bookmarks = new Map<string, number>();
  const notes: Set<string>[] = [];
  const seen = new Set<string>(), ambiguous = new Set<string>();
  for (const { id } of source.paragraphs) {
    if (!id) continue;
    if (seen.has(id)) ambiguous.add(id);
    seen.add(id);
  }
  const bodyIds = new Set(source.paragraphs.flatMap(p =>
    p.id && !ambiguous.has(p.id) && p.text.trim() && !p.figure && !p.bodyTable ? [p.id] : []));
  for (const { group, target } of collectProofreadFindings(source, [], additionalProofreadFindings(source))) {
    const id = target.paragraphId;
    if (!id || !bodyIds.has(id) || target.sectionId !== 'body'
      || (target.paragraphPath?.length && target.paragraphPath[0] !== 'text') || !Object.hasOwn(ADVICE, group)) continue;
    let index = bookmarks.get(id);
    if (index === undefined) {
      if (notes.length >= MAX_COMMENTS) continue;
      index = notes.length;
      bookmarks.set(id, index);
      notes.push(new Set());
    }
    // Comment text contains only our advice, never a finding's title, excerpt,
    // suggested replacement or detected value.
    notes[index].add(ADVICE[group as keyof typeof ADVICE]);
  }
  return { bookmarks, notes };
}

function wordElement(owner: Node, name: string, id?: number): Element {
  const document = owner.nodeType === 9 ? owner as Document : owner.ownerDocument!;
  const namespace = document.documentElement.namespaceURI;
  const element = document.createElementNS(namespace, `w:${name}`);
  if (id !== undefined) element.setAttributeNS(namespace, 'w:id', String(id));
  return element;
}

function addComment(paragraph: Element, definition: Element, id: number, notes: ReadonlySet<string>) {
  const properties = wordChildren(paragraph, 'pPr')[0];
  const start = wordElement(paragraph, 'commentRangeStart', id);
  paragraph.insertBefore(start, properties ? properties.nextSibling : paragraph.firstChild);
  paragraph.appendChild(wordElement(paragraph, 'commentRangeEnd', id));
  const reference = wordElement(paragraph, 'r');
  reference.appendChild(wordElement(paragraph, 'commentReference', id));
  paragraph.appendChild(reference);

  const comment = wordElement(definition, 'comment', id);
  comment.setAttributeNS(definition.namespaceURI, 'w:author', AUTHOR);
  comment.setAttributeNS(definition.namespaceURI, 'w:initials', 'DD');
  for (const note of notes) {
    const line = wordElement(definition, 'p'), run = wordElement(definition, 'r'), text = wordElement(definition, 't');
    text.textContent = note;
    run.appendChild(text);
    line.appendChild(run);
    comment.appendChild(line);
  }
  definition.appendChild(comment);
}

/** Resolve only the temporary bookmarks inserted by the renderer. The exact
 * body paragraph stays the same even when another paragraph repeats its text. */
export async function addWordProofreadComments(blob: Blob, notes: readonly ReadonlySet<string>[], signal: AbortSignal): Promise<Blob> {
  if (!notes.length) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal.throwIfAborted();
  const archive = await readWordArchive(bytes, signal);
  const document = wordXml(archive.get(DOCUMENT_PART), 'document');
  const body = wordChildren(document.documentElement, 'body')[0];
  if (!body) throw new Error('Word output is missing its document body.');
  const starts = wordDescendants(body, 'bookmarkStart').filter(node => wordAttribute(node, 'name')?.startsWith(BOOKMARK_PREFIX));
  const ends = new Map(wordDescendants(body, 'bookmarkEnd').map(node => [wordAttribute(node, 'id'), node]));
  const claimed = new Set<number>(), owners = new Set<Element>();
  const placements = starts.flatMap(start => {
    const suffix = wordAttribute(start, 'name')!.slice(BOOKMARK_PREFIX.length);
    const index = /^\d{1,3}$/.test(suffix) ? Number(suffix) : -1;
    const end = ends.get(wordAttribute(start, 'id')), paragraph = start.parentNode;
    if (!notes[index]?.size || claimed.has(index) || !end || paragraph?.nodeType !== 1 || end.parentNode !== paragraph || owners.has(paragraph as Element)) {
      throw new Error('Word output contains an ambiguous Proofread placement.');
    }
    claimed.add(index);
    const owner = paragraph as Element;
    owners.add(owner);
    owner.removeChild(start);
    owner.removeChild(end);
    if (owner.parentNode !== body || !isWord(owner, 'p') || !readWordParagraphText(owner, 'after', false, () => {}).trim()) return [];
    return [{ paragraph: owner, notes: notes[index] }];
  });
  if (placements.length !== notes.length) throw new Error('Word could not attach all Proofread comments to their body paragraphs. Use the ordinary Word download for this layout.');

  const zip = await JSZip.loadAsync(bytes);
  const serialize = (xml: Document) => new XMLSerializer().serializeToString(xml);
  if (placements.length) {
    const rels = wordXml(archive.get(RELATIONSHIPS_PART), 'relationships'), types = wordXml(archive.get(TYPES_PART), 'content types');
    const relRoot = rels.documentElement, typesRoot = types.documentElement;
    if (relRoot.namespaceURI !== RELATIONSHIPS_NS || typesRoot.namespaceURI !== TYPES_NS) throw new Error('Unsupported Word comment packaging.');
    const existing = xmlChildren(relRoot).filter(relation => {
      const type = relation.getAttribute('Type');
      return type?.endsWith('/comments') && WORD_REL_NAMESPACES.has(type.slice(0, -'/comments'.length));
    });
    if (existing.length > 1 || existing.some(relation => relation.getAttribute('Target') !== 'comments.xml' || relation.getAttribute('TargetMode') === 'External')) {
      throw new Error('The existing Word comments relationship is unsupported.');
    }
    const stored = archive.get(COMMENT_PART);
    if (Boolean(stored) !== Boolean(existing.length)) throw new Error('The existing Word comments are incomplete.');
    const comments = stored ? wordXml(stored, 'comments') : new DOMParser().parseFromString(
      `<w:comments xmlns:w="${document.documentElement.namespaceURI}"/>`, 'application/xml');
    const root = comments.documentElement;
    if (!isWord(root, 'comments')) throw new Error('The existing Word comments are unsupported.');
    const definitions = wordChildren(root, 'comment');
    const ids = new Set([...definitions, ...['commentRangeStart', 'commentRangeEnd', 'commentReference'].flatMap(name => wordDescendants(body, name))]
      .map(node => Number(wordAttribute(node, 'id'))));
    let next = 0;
    for (const [index, placement] of placements.entries()) {
      if (definitions.length + index >= MAX_COMMENTS) break;
      while (ids.has(next)) next++;
      addComment(placement.paragraph, root, next++, placement.notes);
    }
    if (!stored) {
      const relation = rels.createElementNS(RELATIONSHIPS_NS, 'Relationship');
      const used = new Set(xmlChildren(relRoot).map(element => element.getAttribute('Id')));
      let id = 'rIdDonDocsProofread';
      for (let index = 1; used.has(id); index++) id = `rIdDonDocsProofread${index}`;
      relation.setAttribute('Id', id);
      relation.setAttribute('Type', COMMENTS_REL);
      relation.setAttribute('Target', 'comments.xml');
      relRoot.appendChild(relation);
      const override = types.createElementNS(TYPES_NS, 'Override');
      override.setAttribute('PartName', `/${COMMENT_PART}`);
      override.setAttribute('ContentType', COMMENT_TYPE);
      typesRoot.appendChild(override);
      zip.file(RELATIONSHIPS_PART, serialize(rels)).file(TYPES_PART, serialize(types));
    }
    zip.file(COMMENT_PART, serialize(comments));
  }
  zip.file(DOCUMENT_PART, serialize(document));
  signal.throwIfAborted();
  const result = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  signal.throwIfAborted();
  if (result.byteLength > WORD_IMPORT_LIMITS.compressedBytes) throw new Error('The Word copy with Proofread comments exceeds 20 MB.');
  return new Blob([new Uint8Array(result)], { type: WORD_DOCUMENT_TYPE });
}
