/**
 * Pure offset-range resolver for the cartesian CLI runner.
 *
 * Lives in its own file so it can be property-tested without
 * pulling in `run.ts`'s side effects (top-level `_globals` import,
 * `main()` call, vite-node specifics). `run.ts` imports `resolveRange`
 * from here; tests import the same.
 *
 * The math: given a universe size and a set of CLI-shape inputs
 * (`--doc-type`, `--start`, `--end`, `--shard=N/M`, `--limit`),
 * compute the half-open range `[start, end)` of fixture offsets to
 * iterate.
 *
 * Property the test pins down: across `1/M, 2/M, … M/M` shards of the
 * same input range, the union of returned (start, end) intervals
 * covers exactly the input range with no gaps and no overlap. A
 * regression in the shard math would either skip fixtures (silently
 * undertest) or double-cover them (silently waste cycles).
 */

export interface RangeInput {
  /** When set, use universe.perDocType. Otherwise use universe.total. */
  docType?: string;
  /** Inclusive start offset within the universe (defaults to 0). */
  start?: number;
  /** Exclusive end offset within the universe (defaults to universe). */
  end?: number;
  /** 1-of-M shard split, applied after start/end. */
  shard?: { n: number; m: number };
  /** Hard cap on fixture count, applied after shard. */
  limit?: number;
}

export interface UniverseSizes {
  perDocType: number;
  total: number;
}

export interface ResolvedRange {
  start: number;
  end: number;
  total: number;
}

/**
 * Resolve user-friendly args to a concrete `[start, end)` offset window.
 *
 * Order of operations matters:
 *   1. Choose universe size (per-doc-type or total).
 *   2. Apply `--start` / `--end` overrides (clamped within universe).
 *   3. Apply `--shard=N/M` to that range.
 *   4. Apply `--limit` to truncate.
 */
export function resolveRange(args: RangeInput, universe: UniverseSizes): ResolvedRange {
  const u = args.docType ? universe.perDocType : universe.total;

  let start = args.start ?? 0;
  let end = args.end ?? u;

  if (args.shard) {
    const span = end - start;
    const shardSize = Math.ceil(span / args.shard.m);
    const shardStart = start + (args.shard.n - 1) * shardSize;
    const shardEnd = Math.min(end, shardStart + shardSize);
    start = shardStart;
    end = shardEnd;
  }

  if (args.limit !== undefined) {
    end = Math.min(end, start + args.limit);
  }

  return { start, end, total: end - start };
}
