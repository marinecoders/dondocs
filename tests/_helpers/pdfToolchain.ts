/**
 * Toolchain probe for the rendered-PDF tests.
 *
 * These tests compile a real PDF and read it back with pdftotext/pdfinfo. A
 * contributor without poppler installed should get a skip, not a failure — but
 * in CI a skip is indistinguishable from a pass, which is how
 * `by-direction-render` sat there not running at all: the compile-matrix job
 * installed texlive and pandoc but never poppler-utils.
 *
 * So: skip locally, hard-fail in CI. Pair `hasPdfToolchain` with
 * `describeToolchainRequirement()` inside the suite that depends on it.
 */
import { spawnSync } from 'node:child_process';
import { it, expect } from 'vitest';

function has(bin: string, versionFlag: string): boolean {
  try {
    return spawnSync(bin, [versionFlag], { encoding: 'utf-8' }).status === 0;
  } catch {
    return false;
  }
}

export const hasPdfToolchain =
  has('pdflatex', '--version') && has('pdftotext', '-v') && has('pdfinfo', '-v');

/**
 * Registers a test that fails in CI when the toolchain is missing, so the
 * suite's `skipIf` can never turn a dropped dependency into a green run.
 */
export function describeToolchainRequirement(suite: string): void {
  it(`${suite}: pdflatex + pdftotext + pdfinfo are installed (required in CI)`, () => {
    if (process.env.CI) {
      expect(
        hasPdfToolchain,
        'CI must install texlive + poppler-utils; without them these render tests skip and prove nothing.'
      ).toBe(true);
    } else if (!hasPdfToolchain) {
      console.warn(`[${suite}] pdflatex/pdftotext/pdfinfo missing — render tests SKIPPED locally.`);
    }
  });
}
