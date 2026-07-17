/**
 * The endorsement + basic-letter assembly, proved against a real compiled
 * endorsement (not a synthetic PDF) and a real basic letter: the letter's pages
 * come first, the endorsement after, on one PDF — a new-page endorsement
 * continues the basic letter's page numbers (SECNAV M-5216.5 Ch 9).
 *
 * The unit test (tests/unit/assembleEndorsement.test.ts) pins the primitive on
 * pdf-lib fixtures; this compiles the endorsement DonDocs actually produces and
 * reads the assembled pages off with pdftotext, so a real-world layout can't
 * quietly break the order or lose a page.
 *
 * Requires pdflatex + pdftotext + pdfinfo; fails (not skips) in CI without them.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { compileFixture } from '../_helpers/compileLatex';
import { assembleEndorsement } from '@/services/pdf/assembleEndorsement';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;

/** A basic letter whose pages each carry a findable marker word. */
async function basicLetter(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    doc.addPage([612, 792]).drawText(`BASICLETTERPAGE${i}`, {
      x: 72,
      y: 700,
      size: 18,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return doc.save();
}

const endorsementStore = {
  docType: 'new_page_endorsement',
  formData: {
    docType: 'new_page_endorsement',
    fontSize: '12pt',
    fontFamily: 'times',
    pageNumbering: 'none',
    department: 'usmc',
    unitLine1: '1ST BATTALION, 6TH MARINES',
    unitLine2: '2D MARINE DIVISION, II MEF',
    unitAddress: 'PSC BOX 20123, CAMP LEJEUNE, NC 28542-0123',
    sealType: 'dow',
    letterheadColor: 'blue',
    ssic: '5216',
    serial: '0123',
    date: '15 Jan 25',
    from: 'Commanding Officer, 1st Battalion, 6th Marines',
    to: 'Commanding General, II MEF',
    subject: 'APPOINTMENT AS MARINE SECURITY GUARD REPRESENTATIVE',
    basicLetterId: 'CG II MEF ltr 5216 Ser 001 of 5 Jan 25',
    endorsementOrdinal: 'FIRST',
    sigFirst: 'Robert',
    sigMiddle: 'L',
    sigLast: 'SMITH',
    classLevel: 'unclassified',
  },
  references: [],
  enclosures: [],
  paragraphs: [{ text: 'Forwarded, recommending approval.', level: 0 }],
  copyTos: [],
  distributions: [],
} as never;

describe('endorsement + basic-letter assembly — rendered PDF', () => {
  describeToolchainRequirement('endorsement-assembly-render');

  it.skipIf(!toolchain)('puts the basic letter first and the endorsement after', async () => {
    const compiled = await compileFixture(endorsementStore);
    expect(compiled.ok, `pdflatex failed; work dir: ${compiled.workDir}`).toBe(true);

    const letter = await basicLetter(3);
    const result = await assembleEndorsement(compiled.pdfBytes!, letter);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.basicLetterPageCount).toBe(3);

    const dir = await mkdtemp(join(tmpdir(), 'dondocs-assembly-'));
    const pdfPath = join(dir, 'out.pdf');
    await writeFile(pdfPath, result.pdfBytes);

    const pages = Number(
      spawnSync('pdfinfo', [pdfPath], { encoding: 'utf-8' }).stdout.match(/Pages:\s+(\d+)/)?.[1]
    );
    // 3 letter pages + the compiled endorsement (>=1 page).
    expect(pages).toBeGreaterThanOrEqual(4);

    const { stdout } = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' });
    expect(stdout.trim().length).toBeGreaterThan(0);

    // The three letter markers precede the endorsement line, in order.
    const idx = (needle: string) => stdout.indexOf(needle);
    expect(idx('BASICLETTERPAGE1')).toBeGreaterThanOrEqual(0);
    expect(idx('BASICLETTERPAGE1')).toBeLessThan(idx('BASICLETTERPAGE2'));
    expect(idx('BASICLETTERPAGE2')).toBeLessThan(idx('BASICLETTERPAGE3'));
    expect(idx('FIRST ENDORSEMENT')).toBeGreaterThan(idx('BASICLETTERPAGE3'));
    expect(stdout).toMatch(/Forwarded, recommending approval\./);
  });

  // The export gate itself (new-page + attached file only) is a pure function
  // unit-tested in tests/unit/assembleEndorsement.test.ts; this render check
  // only shows a letterless endorsement compiles to its own pages.
  it.skipIf(!toolchain)('an endorsement with no letter compiles to its own pages only', async () => {
    const compiled = await compileFixture(endorsementStore);
    expect(compiled.ok).toBe(true);
    const dir = await mkdtemp(join(tmpdir(), 'dondocs-noassembly-'));
    const p = join(dir, 'out.pdf');
    await writeFile(p, compiled.pdfBytes!);
    const { stdout } = spawnSync('pdftotext', [p, '-'], { encoding: 'utf-8' });
    expect(stdout).toMatch(/FIRST ENDORSEMENT/);
    expect(stdout).not.toMatch(/BASICLETTERPAGE/);
  });
});
