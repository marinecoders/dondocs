/**
 * Differential PDF ⇿ DOCX check for the appended acknowledgement (#203).
 *
 * `tests/unit/appendedEndorsement.test.ts` asserts both generators emit the
 * acknowledgement, but it compares LaTeX *source* — it cannot see whether the
 * DOCX pipeline actually carries it through pandoc onto a Word page. The two
 * paths build the block independently (`\printAppendedEndorsement` in
 * main.tex vs `buildAppendedEndorsement` in flat-generator.ts) and escape it
 * with different escapers, which is exactly how PR #67's underline-subject bug
 * survived a green compile matrix.
 *
 * A PDF and a DOCX that disagree about a signed appointment is the worst
 * outcome this feature can produce: the officer signs one rendering and the
 * appointee acknowledges on another.
 */
import { describe, it, expect } from 'vitest';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { compileFixture } from '../_helpers/compileLatex';
import { compileDocxFixture } from '../_helpers/compileDocx';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;

const store = {
  docType: 'naval_letter',
  formData: {
    docType: 'naval_letter',
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
    to: 'Sergeant J. A. DOE, USMC',
    subject: 'APPOINTMENT AS MARINE SECURITY GUARD REPRESENTATIVE',
    sigFirst: 'Robert',
    sigMiddle: 'L',
    sigLast: 'SMITH',
    classLevel: 'unclassified',
    appendEndorsement: true,
    endorsementBody:
      'I have read and understand the references listed above.\nI hereby assume the duties and responsibilities as the MSG Representative.',
    endorsementSigFirst: 'John',
    endorsementSigMiddle: 'A',
    endorsementSigLast: 'DOE',
    endorsementSerial: 'Ser 1710/024',
    endorsementDate: '3 Feb 25',
  },
  references: [],
  enclosures: [],
  paragraphs: [
    { text: 'Per the references, you are hereby appointed as the MSG Representative.', level: 0 },
  ],
  copyTos: [],
  distributions: [],
} as never;

async function extractPdfText(pdfBytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(pdfBytes) });
  try {
    return (await parser.getText()).text ?? '';
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(docxBytes: Uint8Array): Promise<string> {
  return (await mammoth.extractRawText({ buffer: Buffer.from(docxBytes) })).value;
}

describe('appended acknowledgement — PDF ⇿ DOCX', () => {
  describeToolchainRequirement('appended-endorsement-differential');

  it.skipIf(!toolchain)('carries the acknowledgement into both outputs', async () => {
    const [pdfResult, docxResult] = await Promise.all([
      compileFixture(store),
      compileDocxFixture(store),
    ]);
    expect(pdfResult.ok, `xelatex failed; work dir: ${pdfResult.workDir}`).toBe(true);
    expect(docxResult.ok, `pandoc failed: ${docxResult.stderr ?? ''}`).toBe(true);

    const pdfText = await extractPdfText(pdfResult.pdfBytes!);
    const docxText = await extractDocxText(docxResult.docxBytes!);

    // Blank extraction on either side would make every assertion below vacuous.
    expect(pdfText.trim().length).toBeGreaterThan(0);
    expect(docxText.trim().length).toBeGreaterThan(0);

    // Normalise whitespace: pdftotext and mammoth wrap differently, and the
    // question here is whether the content survives, not how it is laid out.
    const norm = (s: string) => s.replace(/\s+/g, ' ');
    const pdf = norm(pdfText);
    const docx = norm(docxText);

    for (const [label, needle] of [
      ['endorsement line', 'FIRST ENDORSEMENT'],
      ['appointee as sender', 'Sergeant J. A. DOE, USMC'],
      ['officer as addressee', 'Commanding Officer, 1st Battalion, 6th Marines'],
      ['first paragraph', 'I have read and understand the references listed above.'],
      ['second paragraph', 'I hereby assume the duties and responsibilities as the MSG Representative.'],
      ['endorsement date', '3 Feb 25'],
      ['endorsement serial', 'Ser 1710/024'],
    ] as const) {
      expect(pdf, `PDF is missing the ${label}`).toContain(needle);
      expect(docx, `DOCX is missing the ${label}`).toContain(needle);
    }

    // Both halves are signed in both outputs.
    expect(pdf).toContain('R. L. SMITH');
    expect(docx).toContain('R. L. SMITH');
    expect(pdf).toContain('J. A. DOE');
    expect(docx).toContain('J. A. DOE');

    // The body is numbered in both — the DOCX path protects labels from
    // pandoc's list-marker detection with \mbox, so this is a real risk.
    expect(pdf).toMatch(/1\.\s*I have read and understand/);
    expect(docx).toMatch(/1\.\s*I have read and understand/);
    expect(pdf).toMatch(/2\.\s*I hereby assume/);
    expect(docx).toMatch(/2\.\s*I hereby assume/);
  }, 120000);
});
