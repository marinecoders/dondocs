import type { Paragraph } from '@/types/document';
import { isTextRangeBoundary } from './reviewTextRanges';

const MESSAGE = 'This paragraph uses formatting that cannot be split or joined safely. Use ordinary editing, or simplify the formatting before starting a new review.';
interface Run { start: number; end: number; marker?: '**' | '*' | '__'; atomic?: boolean }

/** The native editor stores these three balanced inline markers and whole
 * variable chips. Deliberately reject legacy commands, multiline/HTML content,
 * overlapping/nested marks, and malformed markers rather than flattening them. */
export function reviewStructureTextRuns(text: string): Run[] {
  if (text.length > 20_000 || /[\r\n\\<>]/.test(text) || !isTextRangeBoundary(text, 0)) throw new Error(MESSAGE);
  const runs: Run[] = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('{{', index)) {
      const variable = /^\{\{[A-Z0-9_]+\}\}/.exec(text.slice(index));
      if (!variable) throw new Error(MESSAGE);
      runs.push({ start: index, end: index + variable[0].length, atomic: true });
      index += variable[0].length;
      continue;
    }
    const marker = text.startsWith('**', index) ? '**' : text.startsWith('__', index) ? '__' : text[index] === '*' ? '*' : undefined;
    if (marker) {
      const start = index + marker.length;
      const end = text.indexOf(marker, start);
      if (end <= start || /[*_{}]/.test(text.slice(start, end)) || text[end + marker.length] === marker[0]
        || !isTextRangeBoundary(text, start) || !isTextRangeBoundary(text, end)) throw new Error(MESSAGE);
      runs.push({ start, end, marker });
      index = end + marker.length;
      continue;
    }
    if (text[index] === '}' || text[index] === '{' || text.startsWith('__', index)) throw new Error(MESSAGE);
    const start = index++;
    while (index < text.length && !text.startsWith('{{', index) && !text.startsWith('__', index) && !/[*{}]/.test(text[index])) index++;
    runs.push({ start, end: index });
  }
  return runs;
}

export function assertReviewStructureParagraph(paragraph: Paragraph): void {
  if (Object.entries(paragraph).some(([key, value]) => value !== undefined && !['id', 'text', 'level', 'header', 'portionMarking', 'referenceId'].includes(key))) throw new Error(MESSAGE);
  reviewStructureTextRuns(paragraph.text);
}

/** UTF-16 offset in the stored text, constrained to a complete visible grapheme
 * or a whole variable boundary. Closing/reopening one run keeps its marks. No
 * whitespace is trimmed or synthesized. The original heading/reference stays
 * on the original node and the portion marking applies to both new nodes. */
export function splitReviewParagraph(paragraph: Paragraph, splitAt: number, newId: string): [Paragraph, Paragraph] {
  assertReviewStructureParagraph(paragraph);
  const runs = reviewStructureTextRuns(paragraph.text);
  if (!isTextRangeBoundary(paragraph.text, splitAt) || splitAt <= 0 || splitAt >= paragraph.text.length) throw new Error('Choose a complete character between the first and last text in the paragraph.');
  const run = runs.find(item => splitAt >= item.start && splitAt <= item.end);
  if (!run || run.atomic && splitAt !== run.start && splitAt !== run.end) throw new Error('Place the split outside a variable chip or formatting marker.');
  const runIndex = runs.indexOf(run);
  const visible = runs.map(item => paragraph.text.slice(item.start, item.end)).join('');
  const visibleOffset = runs.slice(0, runIndex).reduce((total, item) => total + item.end - item.start, 0) + splitAt - run.start;
  if (!isTextRangeBoundary(visible, visibleOffset)) throw new Error('Choose a complete visible character, including its combining marks.');
  const marker = run.marker ?? '';
  let left = paragraph.text.slice(0, splitAt), right = paragraph.text.slice(splitAt);
  if (marker) {
    if (splitAt === run.start) { left = paragraph.text.slice(0, run.start - marker.length); right = paragraph.text.slice(run.start - marker.length); }
    else if (splitAt === run.end) { left = paragraph.text.slice(0, run.end + marker.length); right = paragraph.text.slice(run.end + marker.length); }
    else { left += marker; right = marker + right; }
  }
  if (!left || !right) throw new Error('A split must leave text in both paragraphs.');
  reviewStructureTextRuns(left); reviewStructureTextRuns(right);
  const { header: _header, referenceId: _referenceId, ...body } = paragraph;
  return [{ ...paragraph, text: left }, { ...body, id: newId, text: right }];
}

/** The explicit separator is retained exactly, including any existing leading
 * and trailing spaces. Labels/markings on the second paragraph cannot vanish. */
export function joinReviewParagraphs(left: Paragraph, right: Paragraph, separator: '' | ' '): Paragraph {
  assertReviewStructureParagraph(left); assertReviewStructureParagraph(right);
  if (left.level !== right.level || right.header || right.referenceId || left.portionMarking !== right.portionMarking) throw new Error('Join paragraphs at the same level and with the same portion marking. Keep a second heading or reference label in its own paragraph.');
  const text = left.text + separator + right.text;
  reviewStructureTextRuns(text);
  return { ...left, text };
}
