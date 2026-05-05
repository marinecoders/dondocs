/**
 * End-to-end LaTeX compile matrix.
 *
 * Runs `xelatex` on every fixture in `pairwiseMatrix()` — a covering
 * array (IPOG-style) over 18 per-doc-type dimensions, hitting every
 * 2-way (dim_a=val_x, dim_b=val_y) interaction across all 20 doc
 * types. A fixture passes iff xelatex exits 0 and produces a non-empty
 * PDF. This is the gap the rest of the test suite can't close: the
 * unit / property / fuzz tests assert on generator *output strings*,
 * but only this test proves those strings are valid LaTeX.
 *
 * Runs in a separate vitest project (`vitest.integration.config.ts`)
 * so the default `npm test` stays fast. Triggered via
 * `npm run test:integration` locally or the `compile-matrix` job in CI.
 *
 * Requires: `xelatex` on PATH. CI installs it via apt; macOS dev needs
 * MacTeX or BasicTeX. Tests are skipped (with a console warning) if
 * xelatex is unavailable, so a fresh checkout doesn't false-fail.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { pairwiseMatrix } from '../_helpers/compileMatrix';

let xelatexAvailable = false;

beforeAll(() => {
  const result = spawnSync('xelatex', ['--version'], { encoding: 'utf-8' });
  xelatexAvailable = result.status === 0;
  if (!xelatexAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      '[latex-compile] xelatex not found on PATH — skipping all compile tests.\n' +
      'Install MacTeX (macOS) or `apt install texlive-xetex` (Linux) to run this suite.'
    );
  }
});

describe('LaTeX compile matrix', () => {
  const fixtures = pairwiseMatrix();

  describe.each(fixtures)('$name', ({ name, store }) => {
    it('compiles to PDF without xelatex error', async () => {
      if (!xelatexAvailable) return;

      const result = await compileFixture(store);

      if (!result.ok) {
        // The harness keeps `result.workDir` populated; surface it
        // so the dev can `cd <workDir>` and reproduce locally.
        throw new Error(formatFailure(name, result));
      }

      expect(result.pdfBytes).toBeDefined();
      expect(result.pdfBytes!.byteLength).toBeGreaterThan(1000);
    }, 60_000);
  });
});
