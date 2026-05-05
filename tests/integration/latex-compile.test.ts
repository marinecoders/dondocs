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
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { pairwiseMatrix } from '../_helpers/compileMatrix';

// Synchronous toolchain check at module load. Done at top level (not in
// `beforeAll`) so the result is available BEFORE `describe.each` runs,
// letting us use `it.skipIf(...)` and report tests as truly SKIPPED
// (not falsely PASSED) when xelatex is missing. The previous pattern
// used `if (!available) return;` inside the test body, which made
// vitest report 760 passing tests on a runner with no TeX Live —
// silently green CI on machines without a working compile path.
const xelatexAvailable =
  spawnSync('xelatex', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!xelatexAvailable) {
  console.warn(
    '[latex-compile] xelatex not found on PATH — every fixture below will be SKIPPED.\n' +
    'Install MacTeX (macOS) or `apt install texlive-xetex` (Linux) to run this suite.'
  );
}

describe('LaTeX compile matrix', () => {
  const fixtures = pairwiseMatrix();

  describe.each(fixtures)('$name', ({ name, store }) => {
    it.skipIf(!xelatexAvailable)('compiles to PDF without xelatex error', async () => {
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
