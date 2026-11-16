import { isTextRangeBoundary, TEXT_RANGE_CONTEXT_LIMIT } from './reviewTextRanges';

/** A conservative three-way merge of one contiguous edit on each side.
 * Edits use grapheme boundaries so a comparison cannot split a visible character.
 * Wider or overlapping edits stay explicit; this never guesses text identity.
 */
export function reconcileReviewText(baseline: string, current: string, proposed: string): { kind: 'combined' | 'overlap'; value: string } {
  if (current === baseline || current === proposed) return { kind: 'combined', value: proposed };
  if (proposed === baseline) return { kind: 'combined', value: current };
  if ([baseline, current, proposed].some(value => value.length > 20_000) || !('Segmenter' in Intl)) return { kind: 'overlap', value: current };
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const segments = (text: string) => Array.from(segmenter.segment(text), item => item.segment);
  const base = segments(baseline);
  const edit = (text: string) => {
    const next = segments(text);
    let start = 0, end = base.length, nextEnd = next.length;
    while (start < end && start < nextEnd && base[start] === next[start]) start++;
    while (end > start && nextEnd > start && base[end - 1] === next[nextEnd - 1]) { end--;nextEnd--; }
    // Repeated text can place the same minimal insertion/deletion earlier.
    // Include every equivalent alignment when checking the other edit's span.
    let earliest = start, shiftedEnd = end, shiftedNextEnd = nextEnd;
    while (earliest > 0 && base[shiftedEnd - 1] === next[shiftedNextEnd - 1]) {
      earliest--;shiftedEnd--;shiftedNextEnd--;
    }
    return { start, end, earliest, value: next.slice(start, nextEnd) };
  };
  const left = edit(current), right = edit(proposed);
  // Insertions on another edit's boundary are ambiguous and need a decision.
  if (!(left.end < right.earliest || right.end < left.earliest)) return { kind: 'overlap', value: current };
  const result = [...base];
  for (const item of [left, right].sort((a, b) => b.start - a.start)) result.splice(item.start, item.end - item.start, ...item.value);
  const value = result.join('');
  return value.length <= 20_000 ? { kind: 'combined', value } : { kind: 'overlap', value: current };
}


export interface ReviewRangeScope { context: string; start: number; end: number }
export type ReviewRangeReconciliation = {
  kind: 'independent' | 'overlap' | 'ambiguous';
  currentContext: string;
  /** Present only when every optimal grapheme alignment agrees on both boundaries. */
  scope?: ReviewRangeScope;
};
const ALIGNMENT_CELLS = 1_000_000;
const ALIGNMENT_MILLISECONDS = 40;

/** Map known baseline offsets, never a searched quote. All optimal edit paths must
 * agree. Work is bounded; complex or repetitive input asks for an explicit scope.
 * Edits touching either boundary count as overlap, including insertions at a caret.
 */
export function reconcileReviewRange(baseline: ReviewRangeScope, current: string): ReviewRangeReconciliation {
  const ambiguous = (): ReviewRangeReconciliation => ({ kind: 'ambiguous', currentContext: current });
  if ([baseline.context, current].some(text => text.length > TEXT_RANGE_CONTEXT_LIMIT)
    || baseline.start > baseline.end || !isTextRangeBoundary(baseline.context, baseline.start)
    || !isTextRangeBoundary(baseline.context, baseline.end)) return ambiguous();
  if (current === baseline.context) return { kind: 'independent', currentContext: current, scope: { context: current, start: baseline.start, end: baseline.end } };
  if (!isTextRangeBoundary(current, current.length)) return ambiguous();
  const began = performance.now();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const base = [...segmenter.segment(baseline.context)], next = [...segmenter.segment(current)];
  const n = base.length, m = next.length, width = m + 1;
  if ((n + 1) * width > ALIGNMENT_CELLS) return ambiguous();
  const start = baseline.start === baseline.context.length ? n : base.findIndex(part => part.index === baseline.start);
  const end = baseline.end === baseline.context.length ? n : base.findIndex(part => part.index === baseline.end);
  const forward = new Uint16Array((n + 1) * width), backward = new Uint16Array(forward.length);
  for (let j = 0; j <= m; j++) forward[j] = j;
  for (let i = 1; i <= n; i++) {
    if (performance.now() - began > ALIGNMENT_MILLISECONDS) return ambiguous();
    forward[i * width] = i;
    for (let j = 1; j <= m; j++) forward[i * width + j] = Math.min(
      forward[(i - 1) * width + j] + 1, forward[i * width + j - 1] + 1,
      forward[(i - 1) * width + j - 1] + (base[i - 1].segment === next[j - 1].segment ? 0 : 1));
  }
  for (let j = 0; j <= m; j++) backward[n * width + j] = m - j;
  for (let i = n - 1; i >= 0; i--) {
    if (performance.now() - began > ALIGNMENT_MILLISECONDS) return ambiguous();
    backward[i * width + m] = n - i;
    for (let j = m - 1; j >= 0; j--) backward[i * width + j] = Math.min(
      backward[(i + 1) * width + j] + 1, backward[i * width + j + 1] + 1,
      backward[(i + 1) * width + j + 1] + (base[i].segment === next[j].segment ? 0 : 1));
  }
  const cost = forward[n * width + m];
  const starts = new Set<number>(), ends = new Set<number>();
  let touched = false;
  for (let i = 0; i <= n; i++) {
    if (performance.now() - began > ALIGNMENT_MILLISECONDS) return ambiguous();
    for (let j = 0; j <= m; j++) {
      const distance = forward[i * width + j];
      if (distance + backward[i * width + j] !== cost) continue;
      if (i === start) starts.add(j);
      if (i === end) ends.add(j);
      if (i < n && i + 1 >= start && i <= end && distance + 1 + backward[(i + 1) * width + j] === cost) touched = true;
      if (j < m && i >= start && i <= end && distance + 1 + backward[i * width + j + 1] === cost) touched = true;
      if (i < n && j < m && base[i].segment !== next[j].segment && i + 1 >= start && i <= end
        && distance + 1 + backward[(i + 1) * width + j + 1] === cost) touched = true;
    }
  }
  if (starts.size !== 1 || ends.size !== 1) return ambiguous();
  const offset = (index: number) => index === m ? current.length : next[index].index;
  const scope = { context: current, start: offset([...starts][0]), end: offset([...ends][0]) };
  if (scope.start > scope.end) return ambiguous();
  return { kind: touched ? 'overlap' : 'independent', currentContext: current, scope };
}
