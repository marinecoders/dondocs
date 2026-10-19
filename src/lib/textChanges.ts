export interface TextSegment { text: string; changed: boolean }
interface TextChanges { before: TextSegment[]; after: TextSegment[] }

const MAX_COMPARISON_CELLS = 250_000;

/** Exact, whitespace-preserving word comparison with bounded work for large fields. */
export function compareText(before: string, after: string): TextChanges {
  const tokenize = (text: string) => text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
  const left = tokenize(before);
  const right = tokenize(after);
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let endLeft = left.length;
  let endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft--;
    endRight--;
  }
  const result: TextChanges = { before: [], after: [] };
  function append(side: TextSegment[], text: string, changed: boolean) {
    if (!text) return;
    const last = side.at(-1);
    if (last?.changed === changed) last.text += text;
    else side.push({ text, changed });
  }
  const prefix = left.slice(0, start).join('');
  append(result.before, prefix, false);
  append(result.after, prefix, false);
  const a = left.slice(start, endLeft);
  const b = right.slice(start, endRight);
  // Avoid quadratic allocations on pasted publications. Large changed middles
  // remain fully visible, with their common prefix/suffix still unmarked.
  if ((a.length + 1) * (b.length + 1) > MAX_COMPARISON_CELLS) {
    append(result.before, a.join(''), true);
    append(result.after, b.join(''), true);
  } else {
    const width = b.length + 1;
    const lengths = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lengths[i * width + j] = a[i] === b[j]
          ? 1 + lengths[(i + 1) * width + j + 1]
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        append(result.before, a[i++], false);
        append(result.after, b[j++], false);
      } else if (i < a.length && (j === b.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) {
        append(result.before, a[i++], true);
      } else {
        append(result.after, b[j++], true);
      }
    }
  }
  const suffix = left.slice(endLeft).join('');
  append(result.before, suffix, false);
  append(result.after, suffix, false);
  return result;
}
