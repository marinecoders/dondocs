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
    return { start, end, value: next.slice(start, nextEnd) };
  };
  const left = edit(current), right = edit(proposed);
  // Insertions on another edit's boundary are ambiguous and need a decision.
  if (!(left.end < right.start || right.end < left.start)) return { kind: 'overlap', value: current };
  const result = [...base];
  for (const item of [left, right].sort((a, b) => b.start - a.start)) result.splice(item.start, item.end - item.start, ...item.value);
  const value = result.join('');
  return value.length <= 20_000 ? { kind: 'combined', value } : { kind: 'overlap', value: current };
}
