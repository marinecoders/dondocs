/**
 * A backslash in user text — a Windows path is the ordinary case — has to reach
 * both formats intact.
 *
 * Two separate defects, one per format, both found by rendering rather than by
 * reading the generated source:
 *
 *   DOCX body text  `processText` replaced `\` with `\textbackslash{}` and then
 *                   escaped `{` and `}` two lines later, re-escaping the braces
 *                   its own replacement had just introduced. The result,
 *                   `\textbackslash\{\}`, is what pandoc faithfully rendered as
 *                   a literal `\{}`. Word opened fine; the text was wrong.
 *
 *   PDF enclosures  `\xdef\currentencltitle` fully expanded the stored title.
 *                   `\textbackslash` is fragile, so expanding it ran away until
 *                   `! TeX capacity exceeded [input stack size=5000]` — no PDF
 *                   at all, for an enclosure titled `C:\path\to\file`.
 *
 * They are tested together because they are one story to a user and because the
 * formats disagreeing IS the bug: asserting only one would let the other drift.
 *
 * On method: these compile and read the text back. A source-level assertion
 * would have passed throughout the DOCX defect — the generator emitted exactly
 * what it meant to emit, and what it meant was wrong.
 *
 * On underscores: `pdftotext` cannot extract a rendered `\_`, as the underscore
 * suite documents, so nothing here asserts on one.
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

const WIN_PATH = 'C:\\Users\\smith\\budget.xlsx';

function store(fields: { body?: string; enclosure?: string; reference?: string }) {
  return {
    docType: 'naval_letter',
    formData: {
      docType: 'naval_letter', fontSize: '12pt', fontFamily: 'times',
      pageNumbering: 'none', department: 'usmc',
      unitLine1: '1ST BATTALION, 6TH MARINES', unitLine2: '2D MARINE DIVISION, II MEF',
      unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
      sealType: 'dow', letterheadColor: 'blue',
      ssic: '5216', serial: '0123', date: '15 Jan 25',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'Commanding General, II MEF',
      subject: 'BACKSLASH RENDER CHECK',
      sigFirst: 'John', sigMiddle: 'A', sigLast: 'DOE',
      sigRank: 'Lieutenant Colonel', sigTitle: 'Commanding Officer',
      classLevel: 'unclassified',
    },
    references: fields.reference ? [{ letter: 'a', title: fields.reference }] : [],
    enclosures: fields.enclosure ? [{ title: fields.enclosure }] : [],
    paragraphs: [{ text: fields.body ?? 'Routine body text.', level: 0 }],
    copyTos: [], distributions: [],
  } as never;
}

/** Compile — failing here IS the regression — and return the text a reader sees. */
async function renderedPdf(fields: Parameters<typeof store>[0]): Promise<string> {
  const result = await compileFixture(store(fields));
  expect(result.ok, `compile failed; work dir: ${result.workDir}`).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-bs-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, result.pdfBytes!);
  const { stdout } = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' });
  expect(stdout.trim().length, 'pdftotext returned nothing').toBeGreaterThan(0);
  return stdout;
}

async function renderedDocx(fields: Parameters<typeof store>[0]): Promise<string> {
  const result = await compileDocxFixture(store(fields));
  expect(result.ok, result.log.slice(0, 400)).toBe(true);
  return (await mammoth.extractRawText({ buffer: Buffer.from(result.docxBytes!) })).value;
}

describeToolchainRequirement('a backslash in user text');

describe.skipIf(!toolchain)('a backslash in user text — PDF', () => {
  it('survives a Windows path in body text', async () => {
    expect(await renderedPdf({ body: `See ${WIN_PATH} for the figures.` })).toContain(WIN_PATH);
  }, 180_000);

  it('compiles an enclosure title carrying a path', async () => {
    // The \xdef runaway: this produced no PDF at all, not a mangled one.
    const text = await renderedPdf({ enclosure: WIN_PATH });
    expect(text).toContain(WIN_PATH);
  }, 180_000);

  it('compiles a reference title carrying a path', async () => {
    expect(await renderedPdf({ reference: WIN_PATH })).toContain(WIN_PATH);
  }, 180_000);

  it('handles several backslashes in one paragraph', async () => {
    const text = await renderedPdf({ body: 'Copy D:\\a\\b to E:\\c\\d today.' });
    expect(text).toContain('D:\\a\\b');
    expect(text).toContain('E:\\c\\d');
  }, 180_000);

  it('keeps a backslash alongside the other specials', async () => {
    const text = await renderedPdf({ body: 'Path C:\\x costs $5, 50% & more #1.' });
    expect(text).toContain('C:\\x');
    expect(text).toContain('50%');
    expect(text).toContain('$5');
  }, 180_000);
});

describe.skipIf(!toolchain)('a backslash in user text — DOCX', () => {
  it('carries a Windows path in body text into Word', async () => {
    // The regression: this arrived as `See C:\{}Users\{}smith\{}budget.xlsx`.
    const text = await renderedDocx({ body: `See ${WIN_PATH} for the figures.` });
    expect(text).toContain(WIN_PATH);
    expect(text).not.toContain('\\{}');
  }, 180_000);

  it('carries an enclosure title into Word', async () => {
    expect(await renderedDocx({ enclosure: WIN_PATH })).toContain(WIN_PATH);
  }, 180_000);

  it('carries a reference title into Word', async () => {
    expect(await renderedDocx({ reference: WIN_PATH })).toContain(WIN_PATH);
  }, 180_000);

  it('keeps a backslash alongside the other specials', async () => {
    const text = await renderedDocx({ body: 'Path C:\\x costs $5, 50% & more #1.' });
    expect(text).toContain('C:\\x');
    expect(text).toContain('50%');
    expect(text).toContain('$5');
    expect(text).toContain('&');
  }, 180_000);

  it('still underlines __text__ next to a path', async () => {
    // The escaping reorder must not disturb the rich-text markers that run after it.
    const text = await renderedDocx({ body: `The __deadline__ for ${WIN_PATH} is firm.` });
    expect(text).toContain('deadline');
    expect(text).not.toContain('__deadline__');
    expect(text).toContain(WIN_PATH);
  }, 180_000);
});

describe.skipIf(!toolchain)('the two formats agree', () => {
  it('renders the same path text in PDF and in Word', async () => {
    // Neither format is the reference — they have to match each other, which is
    // what a single-format fix would quietly break.
    const body = `Deliver ${WIN_PATH} by Friday.`;
    const [pdf, docx] = await Promise.all([
      renderedPdf({ body }), renderedDocx({ body }),
    ]);
    expect(pdf).toContain(WIN_PATH);
    expect(docx).toContain(WIN_PATH);
  }, 240_000);
});
