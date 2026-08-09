/**
 * The originator's code has to reach the page.
 *
 * It was collected by the UI, stored, and never printed: no generator code and
 * no template referenced it. Nothing caught that, because a test asserting on
 * LaTeX source can only check what the generator emits — and the generator
 * emitted nothing at all.
 *
 * So these compile a real PDF and read the text back out. The assertion is what
 * a reader sees, not what we hoped to write.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileFixture } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import mammoth from 'mammoth';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

function store(fields: Record<string, unknown>) {
  return {
    docType: 'naval_letter',
    formData: {
      docType: 'naval_letter', fontSize: '12pt', fontFamily: 'times',
      pageNumbering: 'none', department: 'usmc',
      unitLine1: '1ST BATTALION, 6TH MARINES', unitLine2: '2D MARINE DIVISION, II MEF',
      unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
      sealType: 'dow', letterheadColor: 'blue',
      ssic: '5216', date: '7 Sep 06',
      from: 'Commanding Officer, 1st Battalion, 6th Marines',
      to: 'Commanding General, II MEF',
      subject: 'SENDER SYMBOL RENDER CHECK',
      sigFirst: 'John', sigMiddle: 'A', sigLast: 'DOE',
      sigRank: 'Lieutenant Colonel', sigTitle: 'Commanding Officer',
      classLevel: 'unclassified',
      ...fields,
    },
    references: [], enclosures: [],
    paragraphs: [{ text: 'Body.', level: 0 }],
    copyTos: [], distributions: [],
  } as never;
}

/** Compile and return the text a reader would see. */
async function rendered(fields: Record<string, unknown>): Promise<string> {
  const result = await compileFixture(store(fields));
  expect(result.ok, `compile failed; work dir: ${result.workDir}`).toBe(true);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-sym-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, result.pdfBytes!);
  const { stdout } = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' });
  expect(stdout.trim().length, 'pdftotext returned nothing').toBeGreaterThan(0);
  return stdout;
}

describeToolchainRequirement("the sender's symbols block");

describe.skipIf(!hasPdfToolchain)("the sender's symbols block", () => {
  it('prints the office code fused with the serial', async () => {
    // SECNAV M-5216.5 Ch 7 para 2a(2): "Ser Code 13/271" under the SSIC.
    const text = await rendered({ officeCode: 'Code 13', serial: '271' });
    expect(text).toContain('5216');
    expect(text).toContain('Ser Code 13/271');
  }, 180_000);

  it('prints an alphanumeric code without a "Code" prefix', async () => {
    const text = await rendered({ officeCode: 'N00J', serial: 'S20' });
    expect(text).toContain('Ser N00J/S20');
    expect(text).not.toContain('Code N00J');
  }, 180_000);

  it('prints the code alone when there is no serial', async () => {
    const text = await rendered({ officeCode: 'N00J', serial: '' });
    expect(text).toContain('N00J');
    // Without a serial there is no "Ser" prefix.
    expect(text).not.toContain('Ser N00J');
  }, 180_000);

  it('prefixes a lone serial with "Ser"', async () => {
    const text = await rendered({ officeCode: '', serial: '001' });
    expect(text).toContain('Ser 001');
  }, 180_000);

  it('omits the line entirely when neither is set', async () => {
    const text = await rendered({ officeCode: '', serial: '' });
    expect(text).toContain('5216');
    expect(text).not.toMatch(/\bSer\b/);
  }, 180_000);
});

describe.skipIf(!hasPdfToolchain)("the sender's symbols block — DOCX path", () => {
  it('composes the same line in Word as in the PDF', async () => {
    // The two generators build this block separately; they used to agree only
    // because both printed the serial bare.
    const result = await compileDocxFixture(store({ officeCode: 'Code 13', serial: '271' }));
    expect(result.ok, result.log.slice(0, 400)).toBe(true);
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(result.docxBytes!) });
    expect(value).toContain('Ser Code 13/271');
  }, 180_000);
});
