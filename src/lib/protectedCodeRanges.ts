export type ProtectedTextRange = readonly [number, number];

/** Hide protected content without changing UTF-16 offsets or line boundaries. */
export function maskProtectedRanges(text: string, ranges: readonly ProtectedTextRange[]): string {
  let cursor = 0;
  let masked = '';
  for (const [start, end] of [...ranges].sort(([a], [b]) => a - b)) {
    if (end <= cursor) continue;
    masked += text.slice(cursor, Math.max(cursor, start));
    masked += text.slice(Math.max(cursor, start), end).replace(/[^\r\n]/g, ' ');
    cursor = end;
  }
  return masked + text.slice(cursor);
}

/** Code delimiters belong to one literal. Shorter backtick runs inside a
 * fence or a multi-backtick inline span must never expose its contents to a
 * text correction. An unfinished literal conservatively protects the tail.
 */
export function protectedCodeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fences = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gm;
  let opening: RegExpExecArray | null;
  while ((opening = fences.exec(text))) {
    const delimiter = opening[1];
    const closing = new RegExp(`^ {0,3}${delimiter[0]}{${delimiter.length},}[ \\t]*(?:\\r?\\n|$)`, 'gm');
    closing.lastIndex = fences.lastIndex;
    const match = closing.exec(text);
    const end = match ? closing.lastIndex : text.length;
    ranges.push([opening.index, end]);
    fences.lastIndex = end;
  }

  const outsideFences = maskProtectedRanges(text, ranges);
  const runs = /`+/g;
  while ((opening = runs.exec(outsideFences))) {
    const length = opening[0].length;
    let closing: RegExpExecArray | null;
    let end = text.length;
    while ((closing = runs.exec(outsideFences))) {
      if (closing[0].length !== length) continue;
      end = runs.lastIndex;
      break;
    }
    ranges.push([opening.index, end]);
    if (!closing) break;
  }
  return ranges.sort(([a], [b]) => a - b);
}
