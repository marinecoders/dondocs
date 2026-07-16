/**
 * Via-addressee numbering, proved on the rendered page in BOTH outputs.
 *
 * SECNAV M-5216.5 Ch 9 ¶2 ("Via:" Line): "If there is only one via addressee
 * remaining, do not number it. If there is more than one remaining, number
 * the remaining addresses starting with the number (1) in parenthesis and
 * consecutively number the rest."
 *
 * The DOCX path numbered via lines from the start; the PDF path never did —
 * the templates render \ViaLineOne..Four verbatim. The fix numbers the lines
 * once, in the shared formatViaLines helper, so this suite asserts three
 * things off the extracted text: the numbers appear in both outputs, a lone
 * via stays unnumbered in both, and nothing double-numbers ("(1) (1)").
 *
 * Requires pdflatex + pdftotext + pandoc; fails rather than skips in CI.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import mammoth from 'mammoth';
import { compileFixture } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { buildBaseline } from '../_helpers/compileMatrix';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const pandocAvailable =
  spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;
const toolchain = hasPdfToolchain && pandocAvailable;

async function renderBoth(via: string): Promise<{ pdf: string; docx: string }> {
  const store = buildBaseline('new_page_endorsement');
  store.formData = { ...store.formData, via };
  // No references or enclosures: their labels ("(a)", "(1)") would collide
  // with the only "(N)" these assertions are about — the via numbers.
  store.references = [];
  store.enclosures = [];

  const [pdfResult, docxResult] = await Promise.all([
    compileFixture(store),
    compileDocxFixture(store),
  ]);
  expect(pdfResult.ok, `pdflatex failed; work dir: ${pdfResult.workDir}`).toBe(true);
  expect(docxResult.ok, `pandoc failed; work dir: ${docxResult.workDir}`).toBe(true);

  const dir = await mkdtemp(join(tmpdir(), 'dondocs-vianum-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, pdfResult.pdfBytes!);
  const { stdout: pdf } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
  expect(pdf.trim().length).toBeGreaterThan(0);

  const { value: docx } = await mammoth.extractRawText({
    buffer: Buffer.from(docxResult.docxBytes!),
  });
  expect(docx.trim().length).toBeGreaterThan(0);

  return { pdf, docx };
}

describe('via addressee numbering — rendered PDF and DOCX', () => {
  describeToolchainRequirement('via-numbering-render');

  it.skipIf(!toolchain)('numbers two remaining via addressees (1), (2) in both outputs', async () => {
    const { pdf, docx } = await renderBoth(
      'Commander, Sea Based Anti-Submarine Warfare Wing, Atlantic\nCommander, Naval Air Force, U.S. Atlantic Fleet'
    );
    for (const [name, text] of [['PDF', pdf], ['DOCX', docx]] as const) {
      expect(text, `${name} lost the first via number`).toMatch(
        /\(1\)\s+Commander, Sea Based/
      );
      expect(text, `${name} lost the second via number`).toMatch(
        /\(2\)\s+Commander, Naval Air Force/
      );
      // Numbering must happen in exactly one place — a prefix from each
      // generator layered on the shared helper would render "(1) (1)".
      expect(text, `${name} double-numbered the via line`).not.toMatch(/\(1\)\s+\(1\)/);
    }
  }, 90_000);

  it.skipIf(!toolchain)('leaves a lone via addressee unnumbered in both outputs', async () => {
    const { pdf, docx } = await renderBoth('Commander, Naval Air Force, U.S. Atlantic Fleet');
    for (const [name, text] of [['PDF', pdf], ['DOCX', docx]] as const) {
      expect(text, `${name} dropped the via line`).toMatch(/Commander, Naval Air Force/);
      expect(text, `${name} numbered a lone via addressee`).not.toContain('(1)');
    }
  }, 90_000);
});
