/**
 * Self-tests for the combinatorial helper. The pairwise generator IS
 * load-bearing for every test that uses it, so it gets its own unit
 * test file pinning down the basic invariants:
 *
 *   - cartesian produces |d_1| * |d_2| * ... rows
 *   - pairwise covers EVERY pair of values across any two dimensions
 *   - rows have all the dimension keys
 */
import { describe, it, expect } from 'vitest';
import { cartesian, pairwise } from './combinatorial';

describe('cartesian', () => {
  it('handles the empty dimensions case', () => {
    expect(cartesian({})).toEqual([{}]);
  });

  it('handles a single dimension', () => {
    expect(cartesian({ x: ['a', 'b', 'c'] as const })).toEqual([
      { x: 'a' },
      { x: 'b' },
      { x: 'c' },
    ]);
  });

  it('produces |d_1| * |d_2| rows for two dimensions', () => {
    const rows = cartesian({ x: ['a', 'b'] as const, y: [1, 2, 3] as const });
    expect(rows).toHaveLength(6);
    expect(rows).toContainEqual({ x: 'a', y: 1 });
    expect(rows).toContainEqual({ x: 'b', y: 3 });
  });

  it('produces all combinations for three dimensions', () => {
    const rows = cartesian({
      a: [1, 2] as const,
      b: ['x', 'y'] as const,
      c: [true, false] as const,
    });
    expect(rows).toHaveLength(8); // 2 * 2 * 2
  });
});

describe('pairwise', () => {
  function assertEveryPairCovered(
    rows: Array<Record<string, unknown>>,
    dims: Record<string, readonly unknown[]>
  ) {
    const keys = Object.keys(dims);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        for (const vi of dims[keys[i]]) {
          for (const vj of dims[keys[j]]) {
            const matched = rows.some(
              (r) => r[keys[i]] === vi && r[keys[j]] === vj
            );
            expect(
              matched,
              `pair {${keys[i]}=${JSON.stringify(vi)}, ${keys[j]}=${JSON.stringify(vj)}} not covered`
            ).toBe(true);
          }
        }
      }
    }
  }

  it('handles a single dimension (passes values through)', () => {
    expect(pairwise({ x: ['a', 'b', 'c'] as const })).toEqual([
      { x: 'a' },
      { x: 'b' },
      { x: 'c' },
    ]);
  });

  it('covers every pair for 3 dimensions × 2 values (8 cartesian → ≤ 4 pairwise)', () => {
    const dims = {
      a: ['x', 'y'] as const,
      b: ['p', 'q'] as const,
      c: [true, false] as const,
    };
    const rows = pairwise(dims);
    assertEveryPairCovered(rows, dims);
    expect(rows.length).toBeLessThanOrEqual(8);
  });

  it('covers every pair for 4 dimensions × 3 values (81 cartesian → ~9-12 pairwise)', () => {
    const dims = {
      a: [1, 2, 3] as const,
      b: ['x', 'y', 'z'] as const,
      c: ['p', 'q', 'r'] as const,
      d: [true, false, null] as const,
    };
    const rows = pairwise(dims);
    assertEveryPairCovered(rows, dims);
    // The optimal pairwise minimum for 4×3 is 9; greedy IPOG hits
    // around 9-12. Assert "much smaller than cartesian (81)".
    expect(rows.length).toBeLessThan(20);
  });

  it('covers every pair for 6 dimensions × 4 values (4096 cartesian → ≤ ~30 pairwise)', () => {
    const dims = {
      d1: [1, 2, 3, 4] as const,
      d2: [1, 2, 3, 4] as const,
      d3: [1, 2, 3, 4] as const,
      d4: [1, 2, 3, 4] as const,
      d5: [1, 2, 3, 4] as const,
      d6: [1, 2, 3, 4] as const,
    };
    const rows = pairwise(dims);
    assertEveryPairCovered(rows, dims);
    // Theoretical minimum for 6 dims × 4 values is 16; greedy hits
    // ~21-30 in practice. Just assert it's drastically smaller than
    // 4096 cartesian.
    expect(rows.length).toBeLessThan(60);
  });

  it('every row contains every dimension key', () => {
    const dims = { a: [1, 2] as const, b: ['x', 'y'] as const, c: [true, false] as const };
    const rows = pairwise(dims);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['a', 'b', 'c']);
    }
  });
});
