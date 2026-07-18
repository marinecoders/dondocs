/**
 * Signature blocks closing a NAVMC 118(11) / Page 11 (6105) entry.
 *
 * A Page 11 counseling entry is authenticated by the counselor and the
 * counseled Marine (MCO 1610.7 / IRAM). DonDocs appends the signature blocks to
 * the end of the remarks body — typed name, a scanned image, or an empty CAC
 * field — the same model the AA form uses. This reads the compiled PDF back and
 * asserts each style actually lands.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib';
import { generateNavmc11811Pdf } from '@/services/pdf/navmc11811Generator';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;
const TPL = join(process.cwd(), 'public/templates/NAVMC11811 - Administrative Remarks/page1.pdf');
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const base = {
  lastName: 'DOE', firstName: 'JOHN', middleName: 'M', edipi: '1234567890',
  remarksText: '6105 counseling entry text.', remarksTextRight: '',
  entryDate: '18 Jul 26', box11: '01',
};

async function generate(data: Record<string, unknown>): Promise<Uint8Array> {
  return generateNavmc11811Pdf(data as never, await readFile(TPL));
}

function sigFieldCount(doc: PDFDocument): number {
  const acro = doc.catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined;
  const fields = acro?.lookup(PDFName.of('Fields')) as PDFArray | undefined;
  if (!fields) return 0;
  let n = 0;
  for (let i = 0; i < fields.size(); i++) {
    const f = fields.lookup(i) as PDFDict;
    if ((f.lookup(PDFName.of('FT')) as PDFName | undefined)?.toString() === '/Sig') n++;
  }
  return n;
}

function imageCount(doc: PDFDocument): number {
  let n = 0;
  for (const pg of doc.getPages()) {
    const res = pg.node.lookup(PDFName.of('Resources')) as PDFDict | undefined;
    const xo = res?.lookup(PDFName.of('XObject')) as PDFDict | undefined;
    if (!xo) continue;
    for (const [, ref] of xo.entries()) {
      const s = doc.context.lookup(ref) as { dict?: PDFDict } | undefined;
      if ((s?.dict?.lookup(PDFName.of('Subtype')) as PDFName | undefined)?.toString() === '/Image') n++;
    }
  }
  return n;
}

function text(bytes: Uint8Array): string {
  const p = join(mkdtempSync(join(tmpdir(), 'aa-11811-')), 'o.pdf');
  writeFileSync(p, Buffer.from(bytes));
  return spawnSync('pdftotext', [p, '-'], { encoding: 'utf-8' }).stdout;
}

describe('NAVMC 118(11) signature blocks', () => {
  describeToolchainRequirement('navmc11811-signatures');

  it.skipIf(!toolchain)('renders typed, image, and digital signatures closing the entry', async () => {
    const bytes = await generate({
      ...base,
      signatureBlocks: [
        { statement: '', name: 'A. B. COUNSELOR', style: 'typed' },
        {
          statement: 'I have been counseled this date and understand this entry.',
          name: 'J. M. DOE',
          style: 'image',
          image: RED_PNG,
        },
        { statement: '', name: 'C. D. WITNESS', style: 'digital' },
      ],
    });
    const doc = await PDFDocument.load(bytes);
    const t = text(bytes);

    expect(t).toMatch(/A\. B\. COUNSELOR/); // typed name printed
    expect(t).toMatch(/J\. M\. DOE/);
    expect(t).toMatch(/I have been counseled this date/); // acknowledgement statement
    expect(sigFieldCount(doc)).toBe(1); // one CAC field, from the digital block
    expect(imageCount(doc)).toBe(1); // one scanned signature, from the image block
  });

  it.skipIf(!toolchain)('adds no signature marks when there are no blocks', async () => {
    const bytes = await generate({ ...base, signatureBlocks: [] });
    const doc = await PDFDocument.load(bytes);
    expect(sigFieldCount(doc)).toBe(0);
    expect(imageCount(doc)).toBe(0);
  });
});
