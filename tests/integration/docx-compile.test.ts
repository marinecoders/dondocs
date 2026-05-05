/**
 * End-to-end DOCX compile matrix via pandoc.
 *
 * Sibling of `latex-compile.test.ts` — same `pairwiseMatrix()` fixture
 * set, different generator path (`flat-generator.ts` instead of the
 * SwiftLaTeX one). Catches: pandoc-incompatible LaTeX constructs,
 * unbalanced braces in the flat generator, package macros pandoc
 * doesn't know.
 *
 * Requires: `pandoc` on PATH (3.x preferred; ships standalone, no TeX
 * Live dependency). Skipped if unavailable.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { pairwiseMatrix } from '../_helpers/compileMatrix';

let pandocAvailable = false;

beforeAll(() => {
  const result = spawnSync('pandoc', ['--version'], { encoding: 'utf-8' });
  pandocAvailable = result.status === 0;
  if (!pandocAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      '[docx-compile] pandoc not found on PATH — skipping all DOCX compile tests.\n' +
      'Install: `brew install pandoc` (macOS) or `apt install pandoc` (Linux).'
    );
  }
});

describe('DOCX compile matrix', () => {
  const fixtures = pairwiseMatrix();

  describe.each(fixtures)('$name', ({ name, store }) => {
    it('converts to DOCX without pandoc error', async () => {
      if (!pandocAvailable) return;

      const result = await compileDocxFixture(store);

      if (!result.ok) {
        throw new Error(formatDocxFailure(name, result));
      }

      expect(result.docxBytes).toBeDefined();
      // A "valid but empty" docx is a few hundred bytes; real ones are
      // > 5 KB even for minimal content.
      expect(result.docxBytes!.byteLength).toBeGreaterThan(2000);
    }, 45_000);
  });
});
