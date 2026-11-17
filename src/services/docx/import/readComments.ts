import { isWord, wordAttribute, wordChildren, wordDescendants, wordXml, xmlChildren, WORD_NAMESPACES } from './archive';

export interface WordComment {
  wordId: string;
  author: string;
  text: string;
  date?: string;
  selection?: { sourceIndex: number; context: string; start: number; end: number };
  unresolved?: string;
}
interface Endpoint { paragraph: Element; sourceIndex: number; cell: boolean; offset: number }

/** Plain comment content keeps separators even though rich styling is not
 * imported. Walk in XML order so words never collapse across a break or tab. */
function commentParagraphText(element: Element): string {
  if (isWord(element, 't')) return element.textContent ?? '';
  if (isWord(element, 'tab')) return '\t';
  if (isWord(element, 'br') || isWord(element, 'cr')) return '\n';
  if (isWord(element, 'noBreakHyphen')) return '\u2011';
  return wordChildren(element).map(commentParagraphText).join('');
}

/** Word offsets are measured in the exact pre-change UTF-16 text, never in
 * serialized native emphasis markers or an editable Word paragraph identifier. */
export function readWordComments(bytes: Uint8Array, body: Element, notice: (text: string) => void): WordComment[] {
  const xml = wordXml(bytes, 'comments');
  if (!isWord(xml.documentElement, 'comments')) throw new Error('Unsupported Word comments namespace.');
  for (const element of Array.from(xml.getElementsByTagName('*'))) {
    if (['comments', 'comment', 'p', 'r', 't'].includes(element.localName) && !WORD_NAMESPACES.has(element.namespaceURI ?? '')) throw new Error('Word comments use an unsupported XML namespace.');
  }
  const starts = new Map<string, Endpoint[]>(), ends = new Map<string, Endpoint[]>();
  const contexts = new Map<Element, string>();
  const record = (map: Map<string, Endpoint[]>, id: string, point: Endpoint) => {
    // Two endpoints already prove ambiguity; never allocate a growing copy for
    // a malicious document containing thousands of the same range marker.
    const previous = map.get(id);
    if (!previous) map.set(id, [point]);
    else if (previous.length < 2) previous.push(point);
  };
  for (const [sourceIndex, block] of xmlChildren(body).entries()) {
    const paragraphs = isWord(block, 'p') ? [block] : wordDescendants(block, 'p');
    for (const paragraph of paragraphs) {
      let text = '';
      const walk = (element: Element) => {
        if (isWord(element, 'ins') || isWord(element, 'moveTo') || isWord(element, 'pPr') || isWord(element, 'rPr') || isWord(element, 'drawing') || isWord(element, 'pict')) return;
        const point = { paragraph, sourceIndex, cell: !isWord(block, 'p'), offset: text.length };
        if (isWord(element, 'commentRangeStart')) record(starts, wordAttribute(element, 'id') ?? '', point);
        else if (isWord(element, 'commentRangeEnd')) record(ends, wordAttribute(element, 'id') ?? '', point);
        else if (isWord(element, 't') || isWord(element, 'delText')) text += element.textContent ?? '';
        else if (isWord(element, 'noBreakHyphen')) text += '\u2011';
        else if (isWord(element, 'tab')) text += '\t';
        else if (isWord(element, 'br') || isWord(element, 'cr')) text += '\n';
        else for (const child of wordChildren(element)) walk(child);
      };
      walk(paragraph);contexts.set(paragraph, text);
    }
  }
  const definitions = wordChildren(xml.documentElement, 'comment');
  if (definitions.length > 100) throw new Error('This Word file has more than 100 comments. Split the review before importing it.');
  const ids = new Set<string>();let characters = 0;
  const comments = definitions.map(element => {
    const wordId = wordAttribute(element, 'id') ?? '';
    if (!/^-?\d{1,10}$/.test(wordId) || ids.has(wordId)) throw new Error('Word comments must have unique, valid IDs. No comments or document content have been imported.');
    ids.add(wordId);
    const paragraphs = wordChildren(element, 'p');
    const text = paragraphs.map(commentParagraphText).join('\n');
    const author = wordAttribute(element, 'author') || 'Unnamed Word reviewer';
    const date = wordAttribute(element, 'date') ?? undefined;
    characters += text.length + author.length;
    if (!text.trim() || text.length > 8_000 || author.length > 1_000 || (date?.length ?? 0) > 100 || characters > 100_000) throw new Error('Word comments exceed their supported text limits or contain an empty comment. Keep the original file and split the review.');
    const start = starts.get(wordId) ?? [], end = ends.get(wordId) ?? [];
    const comment: WordComment = { wordId, text, author, ...(date ? { date } : {}) };
    if (start.length === 1 && end.length === 1 && (start[0].cell || end[0].cell)) {
      comment.unresolved = 'Word table-cell comments are retained as unanchored document discussions; native cell-range review is not supported.';
    } else if (start.length !== 1 || end.length !== 1 || start[0].paragraph !== end[0].paragraph || start[0].offset >= end[0].offset) {
      comment.unresolved = 'The Word range is missing, duplicated, empty or spans paragraphs; it is retained as an unanchored document discussion.';
    } else {
      const context = contexts.get(start[0].paragraph)!;
      comment.selection = { sourceIndex: start[0].sourceIndex, context, start: start[0].offset, end: end[0].offset };
    }
    if (comment.unresolved) notice(comment.unresolved);
    return comment;
  });
  if ([...starts.keys(), ...ends.keys()].some(id => !ids.has(id))) notice('A Word comment range has no matching comment text and remains only in the original file.');
  return comments;
}
