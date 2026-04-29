/**
 * Combinatorial test helpers.
 *
 * Two strategies, picked by problem size:
 *
 *   - `cartesian(dims)`:  full enumeration of every combination.
 *                         Use when |dim_1| × |dim_2| × ... < a few hundred.
 *
 *   - `pairwise(dims)`:   IPOG-style "all-pairs" covering array.
 *                         Generates the smallest test set such that every
 *                         PAIR of values across any two dimensions appears
 *                         in at least one row. Use when full enumeration
 *                         would explode but you still want every two-way
 *                         interaction covered (~50 cases for 6 dimensions
 *                         with 3-5 values each, vs. 3,000+ for cartesian).
 *
 * Why pairwise: empirically, the vast majority of bugs surface from
 * 2-way interactions (feature A + feature B), not from rare 5-way
 * combinations. Pairwise gives you that coverage at ~1% of the cost
 * of a full enumeration. PICT, the de facto standard for this, runs
 * the same algorithm — we re-implement it inline to avoid an external
 * dep.
 */

/**
 * Cartesian product of N dimensions. Each dimension is a list of named
 * options; the output is an array of records, one per combination.
 *
 * Example:
 *   cartesian({ color: ['red','blue'], size: ['S','M'] })
 *   → [{color:'red',size:'S'}, {color:'red',size:'M'},
 *      {color:'blue',size:'S'}, {color:'blue',size:'M'}]
 */
export function cartesian<T extends Record<string, readonly unknown[]>>(
  dims: T
): Array<{ [K in keyof T]: T[K][number] }> {
  const keys = Object.keys(dims) as (keyof T)[];
  if (keys.length === 0) return [{} as { [K in keyof T]: T[K][number] }];

  let acc: Array<{ [K in keyof T]: T[K][number] }> = [{} as { [K in keyof T]: T[K][number] }];
  for (const key of keys) {
    const next: Array<{ [K in keyof T]: T[K][number] }> = [];
    for (const partial of acc) {
      for (const value of dims[key]) {
        next.push({ ...partial, [key]: value });
      }
    }
    acc = next;
  }
  return acc;
}

/**
 * Generate a pairwise (all-pairs) covering set of test cases.
 *
 * Greedy IPOG-style algorithm: for each new dimension, pick the value
 * that covers the most uncovered pairs with the existing rows; extend
 * rows when coverage runs out. Not guaranteed optimal (the optimal
 * minimum is NP-hard) but consistently produces ~3-5× the number of
 * rows of the largest dimension — much smaller than the full
 * cartesian product.
 *
 * Example: 6 dimensions × 4 values each → cartesian = 4,096 rows,
 * pairwise = ~22 rows, every pair covered.
 */
export function pairwise<T extends Record<string, readonly unknown[]>>(
  dims: T
): Array<{ [K in keyof T]: T[K][number] }> {
  type Row = { [K in keyof T]: T[K][number] };
  const keys = Object.keys(dims) as (keyof T)[];
  if (keys.length === 0) return [{} as Row];
  if (keys.length === 1) {
    return (dims[keys[0]] as readonly unknown[]).map((v) => ({ [keys[0]]: v }) as unknown as Row);
  }

  // Track all uncovered (i, j, vi, vj) pairs across keys i < j.
  const pairKey = (i: number, j: number, vi: unknown, vj: unknown) =>
    `${i}|${j}|${JSON.stringify(vi)}|${JSON.stringify(vj)}`;

  const uncovered = new Set<string>();
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      for (const vi of dims[keys[i]]) {
        for (const vj of dims[keys[j]]) {
          uncovered.add(pairKey(i, j, vi, vj));
        }
      }
    }
  }

  const rows: Row[] = [];

  // Repeat until every pair is covered.
  while (uncovered.size > 0) {
    // Greedy: build a row that covers as many uncovered pairs as
    // possible. Start with the value combo that covers the most
    // pairs for the first two dimensions, then extend.
    let bestRow: Partial<Row> | null = null;
    let bestCoverage = -1;

    // Try every (v_0, v_1) combination as a starting seed.
    for (const v0 of dims[keys[0]]) {
      for (const v1 of dims[keys[1]]) {
        const seed: Partial<Row> = { [keys[0]]: v0, [keys[1]]: v1 } as Partial<Row>;
        // Extend greedily through the remaining dimensions.
        for (let k = 2; k < keys.length; k++) {
          let bestValue: unknown = dims[keys[k]][0];
          let bestKCoverage = -1;
          for (const candidate of dims[keys[k]]) {
            // Count newly-covered pairs if we picked `candidate`.
            let count = 0;
            for (let prev = 0; prev < k; prev++) {
              const pk = pairKey(prev, k, seed[keys[prev]], candidate);
              if (uncovered.has(pk)) count++;
            }
            if (count > bestKCoverage) {
              bestKCoverage = count;
              bestValue = candidate;
            }
          }
          seed[keys[k]] = bestValue as Row[keyof T];
        }

        // Tally total uncovered pairs this row would cover.
        let coverage = 0;
        for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) {
            if (uncovered.has(pairKey(i, j, seed[keys[i]], seed[keys[j]]))) {
              coverage++;
            }
          }
        }
        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestRow = seed;
        }
      }
    }

    // Fallback: if no row covers anything new, we're done.
    if (!bestRow || bestCoverage <= 0) break;

    rows.push(bestRow as Row);

    // Mark every pair the chosen row covers as done.
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        uncovered.delete(pairKey(i, j, bestRow[keys[i]], bestRow[keys[j]]));
      }
    }
  }

  return rows;
}

/**
 * Format a row record as a stable test name. Values are JSON-stringified
 * for primitives, keys are alphabetical so test name == row identity.
 */
export function rowName(row: Record<string, unknown>): string {
  return Object.entries(row)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
}
