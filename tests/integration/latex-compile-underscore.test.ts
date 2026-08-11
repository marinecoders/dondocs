/**
 * A lone underscore in body text must not kill the compile.
 *
 * `_` is skipped by the escaping pass because `__text__` is the underline
 * marker. Only the PAIRED form is a marker though, so before this was fixed a
 * single `_` reached LaTeX raw, opened math mode, and produced
 * `! Missing $ inserted.` with no PDF — for input as ordinary as `user_id` or
 * `report_final.docx`.
 *
 * These assert the fixture COMPILES rather than checking what the escaper
 * returns. That distinction is the whole point: `processBodyText('user_id')`
 * returned `'user_id'` perfectly happily, and the existing fuzz tests only
 * assert it does not throw — which is exactly why this shipped.
 *
 * On the text assertions: `pdftotext` cannot extract the rendered `\_` glyph
 * from these Type1 fonts — it yields `user id` for `user_id` and drops a run of
 * underscores entirely. The glyphs ARE on the page (verified by rasterising).
 * So these check the words around the underscore, and the compile itself
 * carries the real weight. Asserting the literal `_` here would be testing
 * pdftotext, not this fix.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import mammoth from 'mammoth';
import { compileFixture } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;

function store(text: string) {
  return {
    docType: 'naval_letter',
    formData: {
      docType: 'naval_letter', fontSize: '12pt', fontFamily: 'times',
      pageNumbering: 'none', department: 'usmc',
      unitLine1: '1ST BATTALION, 6TH MARINES', unitLine2: '2D MARINE DIVISION, II MEF',
      unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
      sealType: 'dow', letterheadColor: 'blue',
      ssic: '1000', serial: '0123', date: '15 Jan 25',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'Commanding General, II MEF',
      subject: 'UNDERSCORE RENDER CHECK',
      sigFirst: 'John', sigMiddle: 'A', sigLast: 'DOE',
      sigRank: 'Lieutenant Colonel', sigTitle: 'Commanding Officer',
      classLevel: 'unclassified',
    },
    references: [], enclosures: [], paragraphs: [{ text, level: 0 }],
    copyTos: [], distributions: [],
  } as never;
}

/** Compile — failing here IS the regression — and return the extracted text. */
async function rendered(text: string): Promise<string> {
  const result = await compileFixture(store(text));
  expect(result.ok, `compile failed; work dir: ${result.workDir}`).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-us-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, result.pdfBytes!);
  const { stdout } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
  // A blank extraction would make every assertion below vacuous.
  expect(stdout.trim().length, 'pdftotext returned nothing').toBeGreaterThan(0);
  return stdout;
}

describeToolchainRequirement('lone underscore in body text');

describe.skipIf(!toolchain)('lone underscore in body text', () => {
  it('compiles a snake_case identifier', async () => {
    const text = await rendered('Send the user_id to the help desk.');
    expect(text).toContain('help desk');
    expect(text).toMatch(/user\s?id/);
  }, 120_000);

  it('compiles a filename', async () => {
    const text = await rendered('Attached is report_final.docx for review.');
    expect(text).toContain('final.docx');
  }, 120_000);

  it('compiles several underscores in one paragraph', async () => {
    const text = await rendered('Fields a_b, c_d and e_f are required.');
    expect(text).toContain('are required');
  }, 120_000);

  it('compiles an email local part', async () => {
    const text = await rendered('Contact first_last@usmc.mil for access.');
    expect(text).toContain('usmc.mil');
  }, 120_000);

  it('compiles a fill-in-the-blank rule', async () => {
    // `__([^_]+?)__` deliberately does not match a long run, so these stay
    // literal. pdftotext drops the run, so the compile is the assertion.
    const text = await rendered('Signature: __________');
    expect(text).toContain('Signature');
  }, 120_000);

  it('compiles underscores alongside the other specials', async () => {
    const text = await rendered('Item user_id costs $5, 50% & more #1.');
    expect(text).toContain('50%');
    expect(text).toContain('$5');
  }, 120_000);

  it('still renders __underline__ as underlined text, not literal underscores', async () => {
    // The paired marker must keep working — that is why `_` is skipped earlier.
    const text = await rendered('The __deadline__ is firm.');
    expect(text).toContain('deadline');
    expect(text).not.toContain('__deadline__');
  }, 120_000);
});

describe.skipIf(!toolchain)('lone underscore in body text — DOCX path', () => {
  async function docxText(text: string): Promise<string> {
    const result = await compileDocxFixture(store(text));
    expect(result.ok, result.log.slice(0, 400)).toBe(true);
    return (await mammoth.extractRawText({ buffer: Buffer.from(result.docxBytes!) })).value;
  }

  it('carries a snake_case identifier into Word', async () => {
    // Word has no math mode, so the raw `_` never broke the DOCX build the way
    // it broke LaTeX — but the escaped form has to survive pandoc intact.
    expect(await docxText('Send the user_id to the help desk.')).toContain('user_id');
  }, 120_000);

  it('still underlines __text__ in Word', async () => {
    const text = await docxText('The __deadline__ is firm.');
    expect(text).toContain('deadline');
    expect(text).not.toContain('__deadline__');
  }, 120_000);
});
