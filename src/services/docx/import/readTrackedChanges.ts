import { isWord, wordAttribute, wordChildren, wordDescendants, xmlChildren, WORD_NAMESPACES } from './archive';

export interface WordTrackedRevision {
  kind: 'insertion' | 'deletion';
  id: string;
  author?: string;
  date?: string;
}
export interface WordTrackedParagraphEdit {
  sourceIndex: number;
  before: string;
  proposed: string;
  beforePlain: string;
  proposedPlain: string;
  revisions: WordTrackedRevision[];
}
type ReadText = (paragraph: Element, view: 'before' | 'after', formatted: boolean) => string;
const MAX_REVISIONS = 2000;
const MAX_PARAGRAPHS = 100;
const MAX_VALUE = 20_000;
const MAX_TOTAL = 190_000; // Leave space for native proposal labels/metadata.
const CUSTOM_XML_REVISIONS = new Set([
  'customXmlInsRangeStart', 'customXmlInsRangeEnd', 'customXmlDelRangeStart', 'customXmlDelRangeEnd',
  'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd', 'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd',
]);
const CONFLICT_REVISIONS = new Set([
  'conflictIns', 'conflictDel', 'customXmlConflictInsRangeStart', 'customXmlConflictInsRangeEnd',
  'customXmlConflictDelRangeStart', 'customXmlConflictDelRangeEnd',
]);
function isUnsupportedMarkupRevision(element: Element): boolean {
  return WORD_NAMESPACES.has(element.namespaceURI ?? '') && CUSTOM_XML_REVISIONS.has(element.localName)
    || element.namespaceURI === 'http://schemas.microsoft.com/office/word/2010/wordml' && CONFLICT_REVISIONS.has(element.localName);
}

/** Revision IDs and author strings are unverified evidence from the original,
 * never native document identities or authority to replace a paragraph. */
export function readWordTrackedChanges(body: Element, readText: ReadText, notice: (message: string) => void): WordTrackedParagraphEdit[] {
  return assessWordTrackedChanges(body, readText, notice).edits;
}

export function assessWordTrackedChanges(body: Element, readText: ReadText, notice: (message: string) => void): { edits: WordTrackedParagraphEdit[]; incomplete: boolean } {
  const children = xmlChildren(body);
  const indexes = new Map(children.map((element, index) => [element, index]));
  const revisions = [...wordDescendants(body, 'ins'), ...wordDescendants(body, 'del')];
  const moves = [...wordDescendants(body, 'moveFrom'), ...wordDescendants(body, 'moveTo'), ...wordDescendants(body, 'moveFromRangeStart'), ...wordDescendants(body, 'moveToRangeStart'), ...wordDescendants(body, 'moveFromRangeEnd'), ...wordDescendants(body, 'moveToRangeEnd')];
  const unsupportedFormatting = ['rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'tblGridChange', 'tblPrExChange', 'trPrChange', 'tcPrChange', 'cellIns', 'cellDel', 'cellMerge', 'numberingChange'].some(name => wordDescendants(body, name).length);
  if (unsupportedFormatting) notice('Word tracked formatting, numbering, table and section changes are not converted. Review their retained original before using the imported layout.');
  // wordXml already bounds this DOM to 50,000 nodes; reuse it rather than
  // reparsing the original or inferring revision status from prose notices.
  const unsupportedMarkup = Array.from(body.getElementsByTagName('*')).some(isUnsupportedMarkupRevision);
  if (unsupportedMarkup) notice('Word custom XML and conflict revisions are not converted to native text proposals. Inspect the retained original.');
  if (moves.length) notice('Word tracked moves are not converted to text replacements. Their original positions and revisions remain in the retained Word file.');
  if (revisions.length > MAX_REVISIONS) {
    notice('This file has too many Word revision records for native text review. No tracked edits were converted; the imported baseline and exact original retain the source.');
    return { edits: [], incomplete: true };
  }
  const parentOf = (element: Element): Element | null => element.parentNode?.nodeType === 1 ? element.parentNode as Element : null;
  const directParagraph = (element: Element): Element | undefined => {
    let current: Element | null = element;
    while (current && parentOf(current) !== body) current = parentOf(current);
    return current && isWord(current, 'p') ? current : undefined;
  };
  const ids = new Map<string, Set<number>>();
  const grouped = new Map<Element, Element[]>();
  let unsupported = 0;
  for (const revision of revisions) {
    const paragraph = directParagraph(revision);
    const id = wordAttribute(revision, 'id');
    if (id) {
      const positions = ids.get(id) ?? new Set<number>();
      positions.add(paragraph ? indexes.get(paragraph)! : -1); ids.set(id, positions);
    }
    if (!paragraph) { unsupported++; continue; }
    const entries = grouped.get(paragraph) ?? []; entries.push(revision); grouped.set(paragraph, entries);
  }
  const result: WordTrackedParagraphEdit[] = [];
  let characters = 0;
  for (const [paragraph, entries] of grouped) {
    const properties = wordChildren(paragraph, 'pPr')[0];
    const style = properties && wordChildren(properties, 'pStyle')[0];
    const nestedRevision = entries.some(entry => {
      let parent = parentOf(entry);
      while (parent && parent !== paragraph) {
        if (isWord(parent, 'ins') || isWord(parent, 'del') || isWord(parent, 'pPr')) return true;
        parent = parentOf(parent);
      }
      return false;
    });
    const unsupportedContent = ['drawing', 'pict', 'object', 'fldChar', 'fldSimple', 'instrText', 'delInstrText', 'sdt', 'rPrChange', 'pPrChange', 'moveFrom', 'moveTo', 'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd']
      .some(name => wordDescendants(paragraph, name).length) || Array.from(paragraph.getElementsByTagName('*')).some(isUnsupportedMarkupRevision);
    const ambiguousIds = entries.some(entry => {
      const id = wordAttribute(entry, 'id');
      return !id || id.length > 100 || ids.get(id)!.size !== 1;
    });
    if (nestedRevision || unsupportedContent || ambiguousIds || style && /^Heading[1-6]$/i.test(wordAttribute(style, 'val') ?? '')) {
      unsupported++; continue;
    }
    try {
      const before = readText(paragraph, 'before', true), proposed = readText(paragraph, 'after', true);
      if (before === proposed) { unsupported++; continue; }
      if (!before.trim() || before.length > MAX_VALUE || proposed.length > MAX_VALUE) { unsupported++; continue; }
      characters += before.length + proposed.length;
      if (result.length >= MAX_PARAGRAPHS || characters > MAX_TOTAL) {
        notice('Word tracked text exceeds the native review size limit. No tracked edits were converted; the baseline and original are preserved.');
        return { edits: [], incomplete: true };
      }
      result.push({ sourceIndex: indexes.get(paragraph)!, before, proposed, beforePlain: readText(paragraph, 'before', false), proposedPlain: readText(paragraph, 'after', false),
        revisions: entries.slice(0, 100).map(entry => ({
          kind: isWord(entry, 'ins') ? 'insertion' : 'deletion', id: wordAttribute(entry, 'id')!,
          ...(wordAttribute(entry, 'author') ? { author: clip(wordAttribute(entry, 'author')!, 200) } : {}),
          ...(wordAttribute(entry, 'date') ? { date: clip(wordAttribute(entry, 'date')!, 100) } : {}),
        })),
      });
      if (entries.length > 100) notice('Word revision metadata is summarized for native paragraph review. Complete revision records remain in the original file.');
    } catch {
      // Newly inserted literal marker characters cannot be represented without
      // changing their meaning in the native editor. Never accept them silently.
      unsupported++;
    }
  }
  if (unsupported) notice('Some Word tracked edits cannot be represented as paragraph-text replacements, including structural or field changes, nested or ambiguous revisions and revisions without a text-only change. They are not native text suggestions; inspect the retained original.');
  if (result.length) notice('Supported Word tracked text is grouped into one native replacement per body paragraph. Author names, dates and Word revision IDs are unverified; review every proposal before accepting it.');
  return { edits: result.sort((left, right) => left.sourceIndex - right.sourceIndex), incomplete: unsupportedFormatting || unsupportedMarkup || moves.length > 0 || unsupported > 0 };
}

export function clip(value: string, length: number): string {
  const result = value.slice(0, length);
  const last = result.charCodeAt(result.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? result.slice(0, -1) : result;
}
