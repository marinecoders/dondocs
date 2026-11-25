/**
 * Column-fit behavior on the NAVMC 118(11).
 *
 * The form is a single physical page: each remarks column prints at most
 * `maxLines` wrapped lines and silently drops the rest. Two things are under
 * test, both against the RENDERED PDF (verify-by-rendering):
 *
 * 1. Calibration — the cap stops at line 37. A rendered probe showed lines
 *    38+ printing over the NAME/EDIPI identification strip at the bottom of
 *    the form, so the cap is a correctness bound, not a style choice.
 * 2. Parity — computeNavmc11811Fit() (what the editor's warning shows) agrees
 *    with what the generator actually printed. If the two ever drift, the
 *    warning lies and silent truncation returns.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  generateNavmc11811Pdf,
  computeNavmc11811Fit,
  type Navmc11811Data,
} from '@/services/pdf/navmc11811Generator';
import { useFormStore } from '@/stores/formStore';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;

const TEMPLATE = 'public/templates/NAVMC11811 - Administrative Remarks/page1.pdf';

const base: Navmc11811Data = {
  lastName: 'DOE',
  firstName: 'JOHN',
  middleName: 'M',
  edipi: '1234567890',
  remarksText: '',
  remarksTextRight: '',
  entryDate: '',
  box11: '',
  signatureBlocks: [],
};

/** N short numbered lines, each guaranteed to wrap to exactly one line. */
const numberedLines = (n: number) =>
  Array.from({ length: n }, (_, i) => `LINE ${String(i + 1).padStart(2, '0')} xxxxxxxxxx`).join('\n');

function pdfText(bytes: Uint8Array): string {
  const p = join(mkdtempSync(join(tmpdir(), 'p11-fit-')), 'o.pdf');
  writeFileSync(p, Buffer.from(bytes));
  return spawnSync('pdftotext', [p, '-'], { encoding: 'utf-8' }).stdout;
}

describe('NAVMC 118(11) column fit', () => {
  describeToolchainRequirement('navmc11811-fit');

  it.skipIf(!toolchain)('caps a column at 37 lines — below the identification strip', async () => {
    const tmpl = readFileSync(TEMPLATE);
    const bytes = await generateNavmc11811Pdf({ ...base, remarksText: numberedLines(45) }, tmpl);
    const text = pdfText(bytes);
    expect(text).toContain('LINE 37');
    // Truncated, not overlapped: 38+ must not appear anywhere on the page.
    expect(text).not.toContain('LINE 38');
    expect(text).not.toContain('LINE 45');
  });

  it.skipIf(!toolchain)('fit report matches the rendered truncation', async () => {
    const data = { ...base, remarksText: numberedLines(45) };
    const fit = await computeNavmc11811Fit(data);
    expect(fit.left.capacity).toBe(37);
    expect(fit.left.lines).toBe(45);
    expect(fit.left.truncated).toBe(8);

    // The rendered PDF drops exactly the lines the report claims: the last
    // printed line is capacity, the first missing one is capacity + 1.
    const tmpl = readFileSync(TEMPLATE);
    const text = pdfText(await generateNavmc11811Pdf(data, tmpl));
    expect(text).toContain(`LINE ${fit.left.capacity}`);
    expect(text).not.toContain(`LINE ${fit.left.capacity + 1}`);
  });

  it.skipIf(!toolchain)('keeps the entry date on the printable copy when remarks start on the right', async () => {
    const data = { ...base, remarksTextRight: 'Right-column training entry', entryDate: '23 Nov 26' };
    const template = readFileSync(TEMPLATE);
    const legacy = pdfText(await generateNavmc11811Pdf(data, template));
    expect(legacy).not.toContain(data.entryDate);
    const text = pdfText(await generateNavmc11811Pdf(data, template, { officialEdition: true })).replace(/\s+/g, ' ');
    expect(text).toContain('Right-column training entry 23 Nov 26');

    const fit = await computeNavmc11811Fit({ ...data, remarksTextRight: numberedLines(37) }, true);
    expect(fit.right.truncated).toBe(0);
    expect(fit.right.spillover).toBe(2);
    await expect(generateNavmc11811Pdf({ ...data, remarksTextRight: numberedLines(37) }, readFileSync(TEMPLATE),
      { officialEdition: true, rejectOverflow: true })).rejects.toThrow('Shorten the remarks');
  });

  it('reports a clean fit for a short entry', async () => {
    const fit = await computeNavmc11811Fit({
      ...base,
      remarksText: numberedLines(10),
      entryDate: '15 Dec 24',
      signatureBlocks: [
        { statement: '', name: 'R. L. SMITH' },
        { statement: 'I have been counseled this date and understand this entry.', name: 'J. M. DOE' },
      ],
    });
    expect(fit.left.truncated).toBe(0);
    expect(fit.left.spillover).toBe(0);
    expect(fit.right.lines).toBe(0);
  });

  it.skipIf(!toolchain)('fits the demo rebuttal advice and election above the Marine signature', async () => {
    const demo = useFormStore.getInitialState().navmc11811;
    const fit = await computeNavmc11811Fit(demo);
    expect(fit.left.truncated).toBe(0);
    expect(fit.left.spillover).toBe(0);

    const bytes = await generateNavmc11811Pdf(demo, readFileSync(TEMPLATE));
    const text = pdfText(bytes).replace(/\s+/g, ' ');
    expect(text).toContain('written rebuttal within 5 working days after acknowledging this entry');
    expect(text).toContain('filed on the document side of my service record');
    expect(text).toMatch(/I choose not to submit a rebuttal\. J\. M\. DOE/);
  });

  it('reports close-out spillover when text + date + signatures exceed the left column', async () => {
    // 35 text lines print (≤37), but date (2) + two signature blocks (4 lines
    // each: gap + statement + 2 signing + name ≈) push past the bottom.
    const fit = await computeNavmc11811Fit({
      ...base,
      remarksText: numberedLines(35),
      entryDate: '15 Dec 24',
      signatureBlocks: [
        { statement: 'Statement.', name: 'R. L. SMITH' },
        { statement: 'Ack.', name: 'J. M. DOE' },
      ],
    });
    expect(fit.left.truncated).toBe(0);
    expect(fit.left.spillover).toBeGreaterThan(0);
  });

  it('places the signature blocks in the right column when it has text', async () => {
    // Right column full to the brim; the signatures land there and spill.
    const fit = await computeNavmc11811Fit({
      ...base,
      remarksText: numberedLines(5),
      remarksTextRight: numberedLines(37),
      signatureBlocks: [{ statement: '', name: 'R. L. SMITH' }],
    });
    expect(fit.right.truncated).toBe(0);
    expect(fit.right.spillover).toBeGreaterThan(0);
    // The left column is untouched by the close-out (no date set).
    expect(fit.left.spillover).toBe(0);
  });

  it('empty blocks add no lines to the close-out', async () => {
    const withEmpty = await computeNavmc11811Fit({
      ...base,
      remarksText: numberedLines(37),
      signatureBlocks: [{ statement: '', name: '' }],
    });
    expect(withEmpty.left.spillover).toBe(0);
  });
});
