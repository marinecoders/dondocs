/**
 * Memorandum For (mf): the addressee must reach the compiled output.
 *
 * The bug this pins: the generators have always gated the title line on
 * `data.to` ("MEMORANDUM FOR [addressee]"), but the editor exposed no field
 * that wrote `to` for this doc type — so the defining line of every
 * Memorandum For rendered blank. The editor field now exists; this test
 * guards the generator half with a real compile, so the line can never
 * silently vanish again.
 *
 * Skipped when pdflatex is absent (same guard as the rest of the harness).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { compileFixture } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';
import { PDFParse } from 'pdf-parse';

const pdflatexAvailable =
  spawnSync('pdflatex', ['--version'], { encoding: 'utf-8' }).status === 0;

async function extractPdfText(pdfBytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(pdfBytes) });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

describe('Memorandum For — addressee in real compiled output', () => {
  it.skipIf(!pdflatexAvailable)(
    'the MEMORANDUM FOR line carries the addressee from `to`',
    async () => {
      const store = buildBaseline('mf');
      store.formData.to = 'Distribution List';

      const result = await compileFixture(store);
      expect(result.ok, result.errors.join('\n') || result.logTail).toBe(true);

      const text = await extractPdfText(result.pdfBytes!);
      // Whitespace-normalize: LaTeX may break the line internally.
      const flat = text.replace(/\s+/g, ' ');
      expect(flat).toContain('MEMORANDUM FOR Distribution List');
    },
    30_000
  );
});
