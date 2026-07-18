/**
 * Rendered-output checks for NAVMC 10274 block 12 — proved on the generated
 * PDF, not the line arrays.
 *
 * Two of these assert fixes for real defects:
 *  - the proposed/recommended action was collected by the UI and silently
 *    dropped from the PDF (the printed form has no box for it; it now closes
 *    block 12), so its presence here fails on the old generator;
 *  - the originator's typed name (the form's caption: "type name of
 *    originator and sign 3 lines below text") did not exist at all — users
 *    hand-typed it and tab-aligned, which textWrap's tab→spaces normalization
 *    makes impossible to position. The bbox check pins the name exactly three
 *    line-heights below the last text line, and the pagination check keeps it
 *    attached to the text across the page-3 overflow.
 *
 * Requires pdftotext; fails rather than skips in CI.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateNavmc10274Pdf,
  type Navmc10274Data,
} from '@/services/pdf/navmc10274Generator';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;

const TEMPLATE_DIR = join(
  process.cwd(),
  'public/templates/NAVMC10274 - Administrative Action'
);

const LINE_HEIGHT = 12; // PAGE2_FIELDS.supplementalInfo.lineHeight

const baseData: Navmc10274Data = {
  actionNo: '1',
  ssicFileNo: '1610',
  date: '16 Jul 26',
  from: 'Sergeant J. A. DOE 1234567890/0111 USMC',
  via: '',
  orgStation: '1st Battalion, 6th Marines',
  to: 'Commanding Officer',
  natureOfAction: 'Formal Counseling',
  copyTo: '',
  references: '(a) MCO 1610.7A',
  enclosures: '',
  supplementalInfo: 'You are counseled for the reasons stated in reference (a).',
  proposedAction: 'Request entry of adverse Page 11 entry per MCO 1610.7A.',
  // The three-signature counseling shape: originator, the Marine's
  // acknowledgement, and a witness.
  signatureBlocks: [
    { statement: '', name: 'R. L. SMITH' },
    { statement: 'I acknowledge receipt and understanding of this counseling.', name: 'T. R. OAKES' },
    { statement: 'Witnessed:', name: 'M. B. JONES' },
  ],
};

async function generate(data: Navmc10274Data) {
  const [page1, page2, page3] = await Promise.all([
    readFile(join(TEMPLATE_DIR, 'page1.pdf')),
    readFile(join(TEMPLATE_DIR, 'page2.pdf')),
    readFile(join(TEMPLATE_DIR, 'page3.pdf')),
  ]);
  const bytes = await generateNavmc10274Pdf(data, page1, page2, page3, {
    includeCoverPage: false,
  });
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-aa-'));
  const pdfPath = join(dir, 'out.pdf');
  await writeFile(pdfPath, bytes);
  return pdfPath;
}

function textOf(pdfPath: string): string {
  const { stdout } = spawnSync('pdftotext', [pdfPath, '-'], { encoding: 'utf-8' });
  return stdout;
}

describe('NAVMC 10274 block 12 — rendered PDF', () => {
  describeToolchainRequirement('navmc10274-render');

  it.skipIf(!toolchain)('renders the proposed action instead of dropping it', async () => {
    const pdfPath = await generate(baseData);
    const text = textOf(pdfPath);
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toMatch(/Proposed\/recommended action: Request entry of adverse Page 11/);
  });

  it.skipIf(!toolchain)('stacks the three signatures in signing order', async () => {
    const pdfPath = await generate(baseData);
    const text = textOf(pdfPath);
    const order = ['R. L. SMITH', 'I acknowledge receipt', 'T. R. OAKES', 'Witnessed:', 'M. B. JONES']
      .map((needle) => text.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it.skipIf(!toolchain)('types the originator exactly three lines below the text', async () => {
    const pdfPath = await generate(baseData);
    const { stdout } = spawnSync('pdftotext', ['-bbox', pdfPath, '-'], { encoding: 'utf-8' });
    const words = [...stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]+)<\/word>/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));
    expect(words.length).toBeGreaterThan(0);

    // The last line of block-12 text is the proposed action; the name sits
    // below it. Blank lines draw nothing, so the y-gap IS the signing space:
    // third line below = exactly 3 line-heights.
    const lastTextY = Math.max(
      ...words.filter((w) => w.text === '1610.7A.').map((w) => w.y)
    );
    const nameY = Math.min(...words.filter((w) => w.text === 'SMITH').map((w) => w.y));
    expect(Number.isFinite(lastTextY)).toBe(true);
    expect(Number.isFinite(nameY)).toBe(true);
    expect(nameY - lastTextY).toBeCloseTo(3 * LINE_HEIGHT, 0);
  });

  it.skipIf(!toolchain)('keeps the signature with the text across the page-3 overflow', async () => {
    // 40 short paragraphs wrap to >29 lines, pushing past page 2's capacity.
    const long = Array.from({ length: 40 }, (_, i) => `${i + 1}. Paragraph.`).join('\n');
    const pdfPath = await generate({ ...baseData, supplementalInfo: long });
    const pages = textOf(pdfPath).split('\f');
    const pageOf = (re: RegExp) => pages.findIndex((p) => re.test(p));
    const lastParaPage = pageOf(/40\. Paragraph\./);
    expect(lastParaPage).toBeGreaterThan(0);
    // Every signature travels with the overflowing text instead of staying
    // behind — and each block stays whole: the Marine's acknowledgement
    // statement is on the same page as the Marine's name.
    for (const name of [/R\. L\. SMITH/, /T\. R\. OAKES/, /M\. B\. JONES/]) {
      expect(pageOf(name)).toBe(lastParaPage);
    }
    expect(pageOf(/I acknowledge receipt/)).toBe(pageOf(/T\. R\. OAKES/));
  });

  it.skipIf(!toolchain)('moves a straddling block whole instead of tearing it', async () => {
    // 23 filler lines put the naive page-2 split (capacity 29) INSIDE the
    // acknowledgement block: statement on one side, name on the other. The
    // group-aware pagination must move the whole block to page 3 — the
    // originator, fitting fully, stays behind on page 2 with the text.
    const filler = Array.from({ length: 23 }, (_, i) => `${i + 1}. Paragraph.`).join('\n');
    const pdfPath = await generate({
      ...baseData,
      supplementalInfo: filler,
      proposedAction: '',
    });
    const pages = textOf(pdfPath).split('\f');
    const pageOf = (re: RegExp) => pages.findIndex((p) => re.test(p));

    expect(pageOf(/R\. L\. SMITH/)).toBe(pageOf(/23\. Paragraph\./));
    // The acknowledgement statement and the Marine's name are inseparable —
    // a name at the top of page 3 with its statement and signing space left
    // on page 2 cannot be signed.
    expect(pageOf(/I acknowledge receipt/)).toBe(pageOf(/T\. R\. OAKES/));
    expect(pageOf(/T\. R\. OAKES/)).toBeGreaterThan(pageOf(/R\. L\. SMITH/));
  });

  it.skipIf(!toolchain)('omits the signature area when there are no blocks', async () => {
    const pdfPath = await generate({ ...baseData, signatureBlocks: [] });
    const text = textOf(pdfPath);
    expect(text).not.toMatch(/R\. L\. SMITH/);
    // The rest of block 12 still renders.
    expect(text).toMatch(/counseled for the reasons/);
  });
});
