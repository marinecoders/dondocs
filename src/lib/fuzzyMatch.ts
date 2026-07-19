/**
 * Subsequence fuzzy matching for the command palette. A query matches when its
 * characters appear in order (not necessarily adjacent) in the target, so "nnl"
 * finds "New Naval Letter" — substring matching returned nothing before.
 *
 * The score rewards the qualities that make a match feel "right": characters
 * that land at the start of a word or the string, and contiguous runs, so an
 * exact prefix beats a scattered subsequence. Returned `indices` are the matched
 * character positions in the ORIGINAL string, for highlighting.
 *
 * Pure and leaf — unit-tested independently of the palette UI.
 */

export interface FuzzyMatch {
  score: number;
  /** Positions in the original string that matched, ascending. */
  indices: number[];
}

const isBoundary = (ch: string | undefined): boolean => ch === undefined || /[\s\-_/().,:]/.test(ch);

/**
 * Match `query` against `text` as a subsequence. Returns the score and matched
 * indices, or null if `text` doesn't contain the query characters in order. An
 * empty query matches everything with a neutral score and no highlight.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, indices: [] };

  const t = text.toLowerCase();
  const indices: number[] = [];
  let from = 0;
  let score = 0;
  let prev = -2; // last matched index, for detecting contiguous runs

  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at === -1) return null; // not a subsequence — no match

    // Quality bonuses, largest where a human would expect the strongest signal.
    if (at === 0) score += 12; // very start of the string
    else if (isBoundary(t[at - 1])) score += 9; // start of a word
    if (at === prev + 1) score += 6; // contiguous with the previous match
    score += Math.max(0, 4 - at * 0.1); // earlier in the string is a little better

    indices.push(at);
    prev = at;
    from = at + 1;
  }

  return { score, indices };
}
