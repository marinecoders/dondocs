import { isTextRangeBoundary, TEXT_RANGE_CONTEXT_LIMIT } from './reviewTextRanges';

/** One explicit edit envelope, located by native input selections, never text search. */
export interface ReviewTypingDraft { baseline: string; text: string; start: number; end: number; proposed: string }
export function emptyReviewTypingDraft(baseline: string): ReviewTypingDraft {
  return { baseline, text: baseline, start: 0, end: 0, proposed: '' };
}
export function typingChangeKind(draft: ReviewTypingDraft): 'Insertion' | 'Deletion' | 'Replacement' | null {
  return draft.text === draft.baseline ? null : draft.start === draft.end ? 'Insertion' : !draft.proposed ? 'Deletion' : 'Replacement';
}
export function plainTypingText(text: string): boolean {
  return text.length <= TEXT_RANGE_CONTEXT_LIMIT && !/[\r\n*\\]|__|\{\{/.test(text)
    && Array.from(text).every(char => char.length !== 1 || !/[\uD800-\uDFFF]/.test(char));
}
export function typingDeletion(text: string, start: number, end: number, backwards: boolean): { start: number; end: number } {
  if (start !== end) return { start, end };
  const boundaries = [...Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text), part => part.index), text.length];
  return backwards ? { start: boundaries.filter(index => index < start).at(-1) ?? 0, end }
    : { start, end: boundaries.find(index => index > end) ?? text.length };
}
/** An insertion or deletion can join text on either side into one character. */
export function typingCaret(text: string, offset: number): number {
  for (const part of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)) {
    if (part.index >= offset) return part.index;
  }
  return text.length;
}
export function editReviewTypingDraft(draft: ReviewTypingDraft, from: number, to: number, insert: string): ReviewTypingDraft {
  if (from > to || !isTextRangeBoundary(draft.text, from) || !isTextRangeBoundary(draft.text, to)) {
    throw new Error('Select complete characters. This edit was refused; the last valid suggested text is retained.');
  }
  const text = draft.text.slice(0, from) + insert + draft.text.slice(to);
  if (!plainTypingText(text)) throw new Error('Only plain text within one paragraph (up to 20,000 characters) is supported. Line breaks, formatting and variables were refused.');
  if (text === draft.baseline) return emptyReviewTypingDraft(draft.baseline);
  const dirty = draft.text !== draft.baseline, oldEnd = draft.start + draft.proposed.length;
  const delta = draft.text.length - draft.baseline.length;
  const mapStart = from < draft.start ? from : from > oldEnd ? from - delta : draft.start;
  const mapEnd = to < draft.start ? to : to > oldEnd ? to - delta : draft.end;
  let start = dirty ? Math.min(draft.start, mapStart) : from;
  let end = dirty ? Math.max(draft.end, mapEnd) : to;
  // Combining marks may join a neighboring character; retain the complete grapheme.
  while (start > 0 && (!isTextRangeBoundary(draft.baseline, start) || !isTextRangeBoundary(text, start))) start--;
  let proposedEnd = end + text.length - draft.baseline.length;
  while (end < draft.baseline.length && (!isTextRangeBoundary(draft.baseline, end) || !isTextRangeBoundary(text, proposedEnd))) { end++;proposedEnd++; }
  if (!isTextRangeBoundary(text, start) || !isTextRangeBoundary(text, proposedEnd)) throw new Error('This edit would split a character. The last valid suggested text is retained.');
  return { baseline: draft.baseline, text, start, end, proposed: text.slice(start, proposedEnd) };
}
