/**
 * A paragraph heading keeps the capitals the author typed.
 *
 * MCO 5216.20B Ch 13 ¶5b: all caps "will not be followed in correspondence
 * unless the abbreviation is made up entirely of the initial letters of major
 * words, (i.e., unless it is an acronym)" — its own examples are HQMC, USMC
 * and MedEvac. SECNAV M-5216.5 Ch 7 ¶13d asks that a heading's key words be
 * capitalized and says nothing about lowering anything.
 *
 * The generator used to lowercase the tail of every word, so TCCOR printed as
 * Tccor and 1st MarDiv as 1st Mardiv. The fixtures below are drawn from the
 * manuals themselves (FOIA, HqDON and the slash form are real SECNAV
 * headings) so the test fails the moment that behaviour comes back.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';
import { HEADING_CASES } from '../_helpers/headingCases';

const toolchain =
  spawnSync('pdflatex', ['--version'], { encoding: 'utf-8' }).status === 0 &&
  spawnSync('pdftotext', ['-v'], { encoding: 'utf-8' }).status === 0;

if (!toolchain) {
  console.warn('[heading-casing] pdflatex/pdftotext missing — SKIPPING.');
}

async function renderedLines(pdf: Uint8Array): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-casing-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, pdf);
  const text = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' }).stdout || '';
  return text.split('\n').map((l) => l.trim().replace(/\s+/g, ' '));
}

describe.skipIf(!toolchain)('paragraph heading casing', () => {
  it('keeps acronyms and mixed-case terms exactly as typed', async () => {
    const store = buildBaseline('naval_letter');
    store.paragraphs = HEADING_CASES.map(({ typed }) => ({ text: 'Body text.', header: typed, level: 0 }));

    const result = await compileFixture(store);
    expect(result.ok, formatFailure('heading-casing', result)).toBe(true);

    const lines = await renderedLines(result.pdfBytes!);
    HEADING_CASES.forEach(({ typed, rendered }, i) => {
      const want = `${i + 1}. ${rendered}. Body text.`;
      const got = lines.find((l) => l.startsWith(`${i + 1}. `) && l.endsWith('Body text.'));
      expect(got, `no rendered line for heading ${i + 1} ("${typed}")`).toBeDefined();
      expect(got, `"${typed}" must render as "${rendered}"`).toBe(want);
    });
  }, 180_000);
});
