/**
 * Harness-fidelity regression: the DOCX test harness must run the SAME
 * pandoc pipeline production runs (`pandoc-converter.ts`), not a bare
 * `--from=latex --to=docx`.
 *
 * Proof by construct: the flat generator rewrites "Enclosure (1)" /
 * "Reference (a)" in body text into `\enclref{1}` / `\reflink{a}`. Those
 * only reach the rendered DOCX when the reader keeps raw tex (`+raw_tex`)
 * AND dondocs.lua converts them back to plain text — exactly the two
 * pieces a bare invocation lacks. Under the old harness this fixture
 * rendered "Per , the roster at is updated quarterly." while a user's
 * export said "Per Reference (a), the roster at Enclosure (1) is updated
 * quarterly." — so every differential suite was green against a pipeline
 * nobody ships. This test fails against that harness.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import mammoth from 'mammoth';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { compileDocxFixture, formatDocxFailure } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';

// Synchronous toolchain check at module load — see `docx-compile.test.ts`
// for the rationale. Marks tests as SKIPPED (not falsely PASSED) when
// pandoc is missing.
const pandocAvailable =
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!pandocAvailable) {
  console.warn(
    '[docx-pipeline-fidelity] pandoc not found on PATH — the fidelity check below will be SKIPPED.'
  );
}

function crossRefStore() {
  const store = buildBaseline('naval_letter');
  store.references = [{ letter: 'a', title: 'MCO 5216.20B' }];
  store.enclosures = [{ title: 'Personnel Roster' }];
  store.paragraphs = [
    {
      text: 'Per Reference (a), the roster at Enclosure (1) is updated quarterly.',
      level: 0,
    },
  ];
  return store;
}

describe('DOCX harness pipeline fidelity', () => {
  it.skipIf(!pandocAvailable)(
    'cross-reference constructs survive into the rendered DOCX text',
    async () => {
      const store = crossRefStore();

      // Premise guard: the fixture must actually exercise the raw-tex
      // constructs. If the escaper ever stops emitting them, the render
      // assertions below would go vacuous — fail loudly here instead.
      const tex = generateFlatLatex(store);
      expect(tex).toContain('\\enclref{1}');
      expect(tex).toContain('\\reflink{a}');

      const result = await compileDocxFixture(store);
      if (!result.ok) {
        throw new Error(formatDocxFailure('naval_letter:cross-refs', result));
      }

      const { value } = await mammoth.extractRawText({
        buffer: Buffer.from(result.docxBytes!),
      });
      const text = value.replace(/\s+/g, ' ');

      expect(text).toContain('Enclosure (1)');
      expect(text).toContain('Reference (a)');
      // The whole sentence, so a harness that silently drops the raw
      // inlines ("Per , the roster at is updated quarterly.") cannot pass.
      expect(text).toContain(
        'Per Reference (a), the roster at Enclosure (1) is updated quarterly.'
      );
    },
    45_000
  );
});
