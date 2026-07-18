/**
 * Digital signature fields on the NAVMC 10274.
 *
 * A signature block marked `digital` gets a real, empty AcroForm `/FT /Sig`
 * field placed in its signing gap — exactly what Acrobat + CAC middleware
 * recognize as signable (DonDocs embeds the field; the CAC signature is applied
 * later in Acrobat). This reads the fields back off the compiled PDF with
 * pdf-lib and asserts: the field is a real /Sig widget, it sits ABOVE the right
 * name, and it lands on the SAME page as the name — including when the block
 * overflows onto the continuation page, where a field left behind on page 2
 * would be unsignable.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from 'pdf-lib';
import { generateNavmc10274Pdf } from '@/services/pdf/navmc10274Generator';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

const toolchain = hasPdfToolchain;
const TDIR = join(process.cwd(), 'public/templates/NAVMC10274 - Administrative Action');

const base = {
  actionNo: '001-25', ssicFileNo: '1610', date: '16 Jul 26', from: 'Sgt J. A. DOE',
  via: '', orgStation: '1st Bn', to: 'CO', natureOfAction: 'Counseling', copyTo: '',
  references: '(a) MCO 1610.7A', enclosures: '',
  supplementalInfo: 'You are counseled for the reasons in reference (a).',
  proposedAction: '',
};

async function generate(data: Record<string, unknown>): Promise<Uint8Array> {
  const [p1, p2, p3] = await Promise.all([
    readFile(join(TDIR, 'page1.pdf')), readFile(join(TDIR, 'page2.pdf')), readFile(join(TDIR, 'page3.pdf')),
  ]);
  return generateNavmc10274Pdf(data as never, p1, p2, p3, { includeCoverPage: false });
}

/** Every /FT /Sig widget in the doc: its page index and rect. */
async function sigFields(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const acro = doc.catalog.lookup(PDFName.of('AcroForm')) as PDFDict | undefined;
  if (!acro) return [];
  const fields = acro.lookup(PDFName.of('Fields')) as PDFArray | undefined;
  if (!fields) return [];
  const pageRefs = doc.getPages().map((p) => doc.context.getObjectRef(p.node)?.toString());
  const out: Array<{ pageIndex: number; rect: number[]; name: string }> = [];
  for (let i = 0; i < fields.size(); i++) {
    const f = fields.lookup(i) as PDFDict;
    if ((f.lookup(PDFName.of('FT')) as PDFName | undefined)?.toString() !== '/Sig') continue;
    const rect = (f.lookup(PDFName.of('Rect')) as PDFArray).asArray().map((n) => (n as { asNumber(): number }).asNumber());
    const pRef = f.get(PDFName.of('P')) as PDFRef | undefined;
    const name = (f.lookup(PDFName.of('T')) as { asString?(): string } | undefined)?.asString?.() ?? '';
    out.push({ pageIndex: pageRefs.indexOf(pRef?.toString()), rect, name });
  }
  return out;
}

/** Page index (0-based) each search string's text lands on, via pdftotext. */
function pageOfText(bytes: Uint8Array, needles: RegExp[]): number[] {
  const dir = mkdtempSync(join(tmpdir(), 'aa-ds-'));
  const p = join(dir, 'o.pdf');
  writeFileSync(p, Buffer.from(bytes));
  const pages = spawnSync('pdftotext', [p, '-'], { encoding: 'utf-8' }).stdout.split('\f');
  return needles.map((re) => pages.findIndex((pg) => re.test(pg)));
}

/** Page indices (0-based) that carry at least one image XObject. */
async function imagePages(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  const out: number[] = [];
  doc.getPages().forEach((pg, i) => {
    const res = pg.node.lookup(PDFName.of('Resources')) as PDFDict | undefined;
    const xo = res?.lookup(PDFName.of('XObject')) as PDFDict | undefined;
    if (!xo) return;
    for (const [, ref] of xo.entries()) {
      const stream = doc.context.lookup(ref) as { dict?: PDFDict } | undefined;
      const sub = stream?.dict?.lookup(PDFName.of('Subtype')) as PDFName | undefined;
      if (sub?.toString() === '/Image') {
        out.push(i);
        return;
      }
    }
  });
  return out;
}

// A 1×1 red PNG — enough to prove an image is embedded and placed.
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('NAVMC 10274 digital signature fields', () => {
  describeToolchainRequirement('navmc10274-digital-sig');

  it.skipIf(!toolchain)('places a real /Sig field above the digital signer on the same page', async () => {
    const bytes = await generate({
      ...base,
      signatureBlocks: [
        { statement: '', name: 'R. L. SMITH', style: 'digital' },
        { statement: 'I acknowledge receipt.', name: 'T. R. OAKES' }, // not digital
      ],
    });
    const fields = await sigFields(bytes);
    // Exactly one field — only the digital block gets one.
    expect(fields).toHaveLength(1);
    const [f] = fields;

    const [smithPage] = pageOfText(bytes, [/R\. L\. SMITH/]);
    expect(f.pageIndex).toBe(smithPage); // field on the signer's page

    // The field is named for its signer (not an anonymous "Signature N"), so
    // Acrobat's signature panel can tell whose field is whose.
    expect(f.name).toMatch(/^R L SMITH signature \d+$/);

    expect(f.rect[0]).toBeGreaterThanOrEqual(30); // block-12 left margin
    expect(f.rect[3] - f.rect[1]).toBeCloseTo(20, 0); // configured height

    // The field must sit ABOVE the typed name — the signing gap between the
    // text and the name, per the form's caption — not overlap or fall below it.
    // pdftotext -bbox is top-left origin; convert the name's glyph top to the
    // PDF's bottom-left origin and require the field's bottom to clear it.
    const pageHeight = 792;
    const bp = join(mkdtempSync(join(tmpdir(), 'aa-bb-')), 'o.pdf');
    writeFileSync(bp, Buffer.from(bytes));
    const bbox = spawnSync('pdftotext', ['-bbox', bp, '-'], { encoding: 'utf-8' }).stdout;
    const smith = [...bbox.matchAll(/yMin="([\d.]+)"[^>]*yMax="[\d.]+">([^<]+)</g)].find((w) => w[2] === 'SMITH');
    expect(smith).toBeTruthy();
    const nameTopPdf = pageHeight - Number(smith![1]);
    expect(f.rect[1]).toBeGreaterThanOrEqual(nameTopPdf); // field bottom clears the name
  });

  it.skipIf(!toolchain)('emits no field when no block is digital', async () => {
    const bytes = await generate({
      ...base,
      signatureBlocks: [{ statement: '', name: 'R. L. SMITH' }],
    });
    expect(await sigFields(bytes)).toHaveLength(0);
  });

  it.skipIf(!toolchain)('follows a digital block onto the continuation page', async () => {
    // Long enough to push the second (digital) block to page 3.
    const filler = Array.from({ length: 26 }, (_, i) => `${i + 1}. Paragraph.`).join('\n');
    const bytes = await generate({
      ...base,
      supplementalInfo: filler,
      signatureBlocks: [
        { statement: '', name: 'R. L. SMITH', style: 'digital' },
        { statement: 'I acknowledge receipt.', name: 'T. R. OAKES', style: 'digital' },
      ],
    });
    const fields = await sigFields(bytes);
    expect(fields).toHaveLength(2);

    const [smithPage, oakesPage] = pageOfText(bytes, [/R\. L\. SMITH/, /T\. R\. OAKES/]);
    // The two signers ended up on different pages (overflow happened).
    expect(oakesPage).toBeGreaterThan(smithPage);

    // Each field is on the SAME page as its signer — the field followed the
    // block. A field stranded on page 2 while its name moved to page 3 would
    // fail here.
    const pages = fields.map((f) => f.pageIndex).sort();
    expect(pages).toEqual([smithPage, oakesPage].sort());
  });
});

describe('NAVMC 10274 image signature blocks', () => {
  describeToolchainRequirement('navmc10274-image-sig');

  it.skipIf(!toolchain)('embeds a scanned signature on the signer\'s page, and only when style is image', async () => {
    const withImage = await generate({
      ...base,
      signatureBlocks: [{ statement: '', name: 'R. L. SMITH', style: 'image', image: RED_PNG }],
    });
    const [smithPage] = pageOfText(withImage, [/R\. L\. SMITH/]);
    expect(await imagePages(withImage)).toContain(smithPage); // image landed on the signer's page

    // Differential: the same doc typed (no image) has no image on that page, so
    // the one above is ours — not a template graphic.
    const typed = await generate({
      ...base,
      signatureBlocks: [{ statement: '', name: 'R. L. SMITH', style: 'typed' }],
    });
    expect(await imagePages(typed)).not.toContain(smithPage);
  });

  it.skipIf(!toolchain)('follows an image block onto the continuation page', async () => {
    const filler = Array.from({ length: 26 }, (_, i) => `${i + 1}. Paragraph.`).join('\n');
    const bytes = await generate({
      ...base,
      supplementalInfo: filler,
      signatureBlocks: [
        { statement: '', name: 'R. L. SMITH', style: 'image', image: RED_PNG },
        { statement: 'I acknowledge receipt.', name: 'T. R. OAKES', style: 'image', image: RED_PNG },
      ],
    });
    const [smithPage, oakesPage] = pageOfText(bytes, [/R\. L\. SMITH/, /T\. R\. OAKES/]);
    expect(oakesPage).toBeGreaterThan(smithPage); // overflow happened
    const imgs = await imagePages(bytes);
    expect(imgs).toContain(smithPage);
    expect(imgs).toContain(oakesPage); // the image followed its block to page 3
  });
});
