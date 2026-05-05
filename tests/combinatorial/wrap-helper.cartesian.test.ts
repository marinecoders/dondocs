/**
 * Full-cartesian combinatorial test for `wrapTextForForm`.
 *
 * The dimensions are small enough (5 × 3 × 3 × 3 × 3 = 405 combos)
 * that we enumerate ALL of them. Pairwise would buy us nothing here
 * — full coverage is cheap.
 *
 * Each row:
 *   1. Builds a synthetic input from the dim values.
 *   2. Runs `wrapTextForForm`.
 *   3. Asserts the contract:
 *      - never throws
 *      - non-empty output for non-empty input
 *      - words preserved (no silent drops)
 *      - line count bounded
 *
 * Catches: any regression that breaks the wrap helper for some
 * specific shape of input — the kind of bug PR #65 surfaced
 * (`label-only paragraph + non-zero leading whitespace`).
 */
import { describe, it, expect } from 'vitest';
import { wrapTextForForm } from '@/services/pdf/textWrap';
import { cartesian, rowName } from '../_helpers/combinatorial';
import { monoFont } from '../_helpers/monoFont';

const dims = {
  /** Leading prefix shape — covers SECNAV levels 0-3 plus tab-leading. */
  leading: ['', '  ', '   ', '    ', '\t'] as const,
  /** SECNAV label or no label. */
  label: ['', '1.', 'a.', '(1)', '(a)'] as const,
  /** Body shape: empty (label-only), short (single line), long (wraps). */
  body: ['', 'short text', 'long enough text that should wrap to several lines'] as const,
  /** Width of the wrap window. */
  maxWidth: [12, 22, 50] as const,
  /** Number of paragraphs. */
  paragraphCount: [1, 2, 4] as const,
};

const rows = cartesian(dims);

describe(`wrapTextForForm — cartesian (${rows.length} combinations)`, () => {
  for (const row of rows) {
    it(rowName(row), () => {
      // Build synthetic input.
      const labelPart = row.label ? `${row.label} ` : '';
      const paragraph = `${row.leading}${labelPart}${row.body}`.trimEnd();
      const input = Array.from({ length: row.paragraphCount }, () => paragraph).join('\n');

      // 1. Never throws.
      let output: string[] = [];
      expect(() => {
        output = wrapTextForForm(input, row.maxWidth, monoFont, 1);
      }).not.toThrow();

      // 2. Returns at least one line. Even fully-empty input gives [""].
      expect(output.length).toBeGreaterThanOrEqual(1);

      // 3. Words preserved (modulo whitespace collapse + tab→spaces normalization).
      const inputWords = input
        .replace(/\t/g, '    ')
        .split(/\s+/)
        .filter((w) => w.length > 0);
      const outputWords = output
        .join(' ')
        .split(/\s+/)
        .filter((w) => w.length > 0);
      expect(outputWords.sort()).toEqual(inputWords.sort());

      // 4. Line count is bounded — guards against infinite-wrap bugs.
      expect(output.length).toBeLessThan(input.length + 100);
    });
  }
});
