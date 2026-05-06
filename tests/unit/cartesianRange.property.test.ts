/**
 * Property + unit tests for `tests/cartesian/range.ts:resolveRange`.
 *
 * The cartesian CLI runner has a `--shard=N/M` flag that lets a single
 * compute job take responsibility for a slice of the fixture space.
 * If the offset math is wrong, fixtures either get skipped (silent
 * undertest, the worst kind of bug) or get covered twice (silent
 * waste). Neither shows up at runtime — the runner happily reports
 * "Failed: 0" on whatever subset it actually ran.
 *
 * The headline property is therefore:
 *
 *   For any input (start, end) range and any M, the union of
 *   resolveRange(shard=1/M) ... resolveRange(shard=M/M) covers
 *   exactly [start, end) — no gaps, no overlap.
 *
 * If resolveRange is broken, this property fails on small inputs
 * with descriptive output.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveRange, type RangeInput, type UniverseSizes } from '../cartesian/range';

const TINY_UNIVERSE: UniverseSizes = { perDocType: 1000, total: 20_000 };

describe('resolveRange — defaults + overrides', () => {
  it('no args, no docType → covers the full total universe', () => {
    expect(resolveRange({}, TINY_UNIVERSE)).toEqual({
      start: 0,
      end: TINY_UNIVERSE.total,
      total: TINY_UNIVERSE.total,
    });
  });

  it('docType set → universe is per-doc-type, not total', () => {
    expect(resolveRange({ docType: 'naval_letter' }, TINY_UNIVERSE)).toEqual({
      start: 0,
      end: TINY_UNIVERSE.perDocType,
      total: TINY_UNIVERSE.perDocType,
    });
  });

  it('explicit start/end overrides defaults', () => {
    expect(resolveRange({ start: 100, end: 250 }, TINY_UNIVERSE)).toEqual({
      start: 100,
      end: 250,
      total: 150,
    });
  });

  it('limit truncates the end', () => {
    expect(resolveRange({ limit: 5 }, TINY_UNIVERSE)).toEqual({
      start: 0,
      end: 5,
      total: 5,
    });
  });

  it('limit + start: limit caps how many fixtures from start, not absolute end', () => {
    expect(resolveRange({ start: 100, limit: 5 }, TINY_UNIVERSE)).toEqual({
      start: 100,
      end: 105,
      total: 5,
    });
  });
});

describe('resolveRange — single-shard cases', () => {
  it('shard 1/1 returns the full range unchanged', () => {
    const r = resolveRange({ shard: { n: 1, m: 1 } }, TINY_UNIVERSE);
    expect(r.start).toBe(0);
    expect(r.end).toBe(TINY_UNIVERSE.total);
  });

  it('shard 1/M starts at the input start', () => {
    expect(resolveRange({ start: 50, shard: { n: 1, m: 4 } }, TINY_UNIVERSE).start).toBe(50);
  });

  it('shard M/M ends exactly at the input end (regardless of ceil rounding)', () => {
    // 1000 / 7 = ~142.86 → ceil to 143. With 7 shards of 143 each,
    // shard 7 would naively start at 6*143 = 858 and run to 858+143 = 1001.
    // The clamp must cap end at universe (1000).
    const r = resolveRange(
      { docType: 'naval_letter', shard: { n: 7, m: 7 } },
      TINY_UNIVERSE
    );
    expect(r.end).toBe(1000);
  });
});

describe('resolveRange — partition property (every offset covered exactly once across all shards)', () => {
  /**
   * Reconstruct the union of all M shard ranges. Property: equal to
   * [inputStart, inputEnd) as a set.
   */
  function unionOfAllShards(
    base: RangeInput,
    m: number,
    universe: UniverseSizes
  ): { covered: number[]; expected: { start: number; end: number } } {
    const baseRange = resolveRange(base, universe);
    const expectedStart = baseRange.start;
    const expectedEnd = baseRange.end;
    const covered: number[] = [];
    for (let n = 1; n <= m; n++) {
      const r = resolveRange({ ...base, shard: { n, m } }, universe);
      // Walk every offset this shard claims to handle.
      for (let i = r.start; i < r.end; i++) covered.push(i);
    }
    return { covered, expected: { start: expectedStart, end: expectedEnd } };
  }

  it('single sample: M=4 over [0, 1000) covers each offset exactly once', () => {
    const { covered, expected } = unionOfAllShards(
      { docType: 'x', shard: undefined },
      4,
      TINY_UNIVERSE
    );
    const expectedSet: number[] = [];
    for (let i = expected.start; i < expected.end; i++) expectedSet.push(i);
    covered.sort((a, b) => a - b);
    expect(covered).toEqual(expectedSet);
  });

  it('property: union over [start, end) shards 1..M = [start, end), no gaps no overlap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 16 }),
        (s, span, m) => {
          const start = s;
          const end = s + span;
          // Universe must be at least `end` so we don't accidentally
          // hit the universe-clamp path. Pad a bit.
          const universe: UniverseSizes = { perDocType: end + 50, total: end + 50 };
          const { covered, expected } = unionOfAllShards(
            { start, end },
            m,
            universe
          );

          // Build expected set [expected.start, expected.end).
          const expectedSet = new Set<number>();
          for (let i = expected.start; i < expected.end; i++) expectedSet.add(i);

          // Property 1: every input offset is covered.
          const coveredSet = new Set(covered);
          for (const i of expectedSet) {
            if (!coveredSet.has(i)) {
              throw new Error(
                `gap at offset ${i}: not covered by any shard (start=${start}, end=${end}, m=${m})`
              );
            }
          }
          // Property 2: no offset is double-covered.
          if (covered.length !== coveredSet.size) {
            const counts = new Map<number, number>();
            for (const i of covered) counts.set(i, (counts.get(i) ?? 0) + 1);
            const dups = Array.from(counts.entries()).filter(([, c]) => c > 1);
            throw new Error(
              `overlap detected: ${dups.length} offsets covered twice ` +
              `(first: ${dups[0][0]}; start=${start}, end=${end}, m=${m})`
            );
          }
          // Property 3: no out-of-range offset is covered.
          for (const i of coveredSet) {
            if (!expectedSet.has(i)) {
              throw new Error(
                `out-of-range offset ${i} covered (range was [${start}, ${end}); m=${m})`
              );
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('property: each shard returns a range entirely within [start, end)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1, max: 20 }),
        (start, span, m) => {
          const end = start + span;
          const universe: UniverseSizes = { perDocType: end + 50, total: end + 50 };
          for (let n = 1; n <= m; n++) {
            const r = resolveRange({ start, end, shard: { n, m } }, universe);
            expect(r.start, `shard ${n}/${m}: start ${r.start} < ${start}`).toBeGreaterThanOrEqual(start);
            expect(r.end, `shard ${n}/${m}: end ${r.end} > ${end}`).toBeLessThanOrEqual(end);
            expect(r.total, `shard ${n}/${m}: total != end - start`).toBe(r.end - r.start);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('property: shards are non-overlapping (n=k start ≥ n=k-1 end)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.integer({ min: 1, max: 300 }),
        fc.integer({ min: 2, max: 16 }),
        (start, span, m) => {
          const end = start + span;
          const universe: UniverseSizes = { perDocType: end + 50, total: end + 50 };
          let prevEnd = start;
          for (let n = 1; n <= m; n++) {
            const r = resolveRange({ start, end, shard: { n, m } }, universe);
            expect(
              r.start,
              `shard ${n}/${m} starts at ${r.start} but previous shard ended at ${prevEnd}`
            ).toBeGreaterThanOrEqual(prevEnd);
            prevEnd = r.end;
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('resolveRange — combined shard + limit', () => {
  it('shard before limit: limit caps THIS SHARD only, not the input range', () => {
    // Range [0, 1000), shard 2/4 → [250, 500). Apply --limit=10 → [250, 260).
    const r = resolveRange(
      { start: 0, end: 1000, shard: { n: 2, m: 4 }, limit: 10 },
      TINY_UNIVERSE
    );
    expect(r.start).toBe(250);
    expect(r.end).toBe(260);
    expect(r.total).toBe(10);
  });

  it('limit larger than shard size is a no-op', () => {
    // shard 1/4 of [0, 1000) is [0, 250) (size 250). Limit=999 → unchanged.
    const r = resolveRange(
      { start: 0, end: 1000, shard: { n: 1, m: 4 }, limit: 999 },
      TINY_UNIVERSE
    );
    expect(r.start).toBe(0);
    expect(r.end).toBe(250);
    expect(r.total).toBe(250);
  });
});
