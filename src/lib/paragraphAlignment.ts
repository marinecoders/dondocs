import { paragraphIdSchema } from './paragraphIdentity';

interface ParagraphIdentity { id?: string }
export interface ParagraphAlignment {
  mode: 'identity' | 'position';
  pairs: { beforeIndex: number; afterIndex: number; moved: boolean }[];
  added: number[];
  removed: number[];
  notices: string[];
}

function identified(paragraphs: readonly ParagraphIdentity[]): boolean {
  const ids = new Set<string>();
  for (const paragraph of paragraphs) {
    if (!paragraph || typeof paragraph !== 'object' || !paragraphIdSchema.safeParse(paragraph.id).success || ids.has(paragraph.id!)) return false;
    ids.add(paragraph.id!);
  }
  return true;
}

/** A longest increasing subsequence gives a minimum reordering of unique IDs.
 * Insertions/deletions are absent from this sequence, so index shifts alone
 * never become moves. Work is O(n log n), including for long publications. */
function stationaryIndices(pairs: readonly { beforeIndex: number; afterIndex: number }[], afterLength: number): Set<number> {
  const tree = new Int32Array(afterLength + 1).fill(-1);
  const lengths = new Int32Array(pairs.length);
  const fixed = new Int32Array(pairs.length);
  const previous = new Int32Array(pairs.length).fill(-1);
  // Among equally long subsequences, prefer unchanged absolute positions,
  // then earlier source order. A reversal should not invent a move 2 → 2.
  const best = (a: number, b: number) => {
    if (a < 0) return b;
    if (b < 0) return a;
    if (lengths[a] !== lengths[b]) return lengths[a] > lengths[b] ? a : b;
    if (fixed[a] !== fixed[b]) return fixed[a] > fixed[b] ? a : b;
    return Math.min(a, b);
  };
  const prefix = (position: number) => {
    let result = -1;
    for (let index = position; index > 0; index -= index & -index) result = best(result, tree[index]);
    return result;
  };
  pairs.forEach((pair, index) => {
    previous[index] = prefix(pair.afterIndex);
    lengths[index] = (previous[index] < 0 ? 0 : lengths[previous[index]]) + 1;
    fixed[index] = (previous[index] < 0 ? 0 : fixed[previous[index]]) + Number(pair.beforeIndex === pair.afterIndex);
    for (let position = pair.afterIndex + 1; position < tree.length; position += position & -position) tree[position] = best(tree[position], index);
  });
  const stationary = new Set<number>();
  for (let index = prefix(afterLength); index !== -1; index = previous[index]) stationary.add(index);
  return stationary;
}

/** Compare saved identities, never text matches or freshly assigned IDs. */
export function alignParagraphs(before: readonly ParagraphIdentity[], after: readonly ParagraphIdentity[]): ParagraphAlignment {
  const positional = (notice: string): ParagraphAlignment => ({ mode: 'position', pairs: [], added: [], removed: [], notices: [notice] });
  if (!identified(before) || !identified(after)) return positional('Some paragraphs lack unique valid identities. Paragraphs are compared by position; movement cannot be determined.');
  const left = new Map(before.map((paragraph, index) => [paragraph.id!, index]));
  const right = new Map(after.map((paragraph, index) => [paragraph.id!, index]));
  const common = before.flatMap((paragraph, beforeIndex) => {
    const afterIndex = right.get(paragraph.id!);
    return afterIndex === undefined ? [] : [{ beforeIndex, afterIndex }];
  });
  // Independent copies may intentionally regenerate every ID. Identity-only
  // differences must not turn otherwise identical text into deletion/addition.
  if (before.length && after.length && !common.length) return positional('These versions have no shared paragraph identities. Paragraphs are compared by position; movement cannot be determined.');
  const stationary = stationaryIndices(common, after.length);
  const pairs = common.map((pair, index) => ({ ...pair, moved: !stationary.has(index) }));
  const notices: string[] = [];
  if (pairs.some(pair => pair.beforeIndex !== pair.afterIndex)) notices.push('Paragraph positions and automatic renumbering are separate from text edits. Shifted positions alone are not reported as moved paragraphs.');
  if (pairs.some(pair => pair.moved)) notices.push('Moves show one minimum reordering consistent with saved paragraph identities; snapshots do not record which editing gesture was used.');
  return { mode: 'identity', pairs,
    added: after.flatMap((paragraph, index) => left.has(paragraph.id!) ? [] : [index]),
    removed: before.flatMap((paragraph, index) => right.has(paragraph.id!) ? [] : [index]), notices };
}
