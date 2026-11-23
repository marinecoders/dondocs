import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { finishTaggedPdf, type PdfTaggingPlan } from '@/services/pdf/accessibility/taggedPdf';
import { readPdfContent } from '@/services/pdf/accessibility/contentStream';
import { fingerprintPdfRaster } from '@/services/pdf/accessibility/raster';

const NONCE = '2a5b9426e0f54ba89e91c8452ef7ce1b';
const plan = (): PdfTaggingPlan => ({ nonce: NONCE, title: 'Training example', language: 'en-US', nodes: [{ id: 1, role: 'P' }] });

async function fixture(options: { wrongNonce?: boolean; missingEnd?: boolean; unmarked?: boolean; unknownId?: boolean; preexisting?: boolean } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const point = (id: number, begin: boolean) => `/DDTag << /N <${options.wrongNonce ? '0'.repeat(32) : NONCE}> /I ${id} /B ${begin} >> DP\n`;
  for (let pageIndex = 0; pageIndex < 2; pageIndex++) {
    const page = pdf.addPage();
    let text = !pageIndex && !options.unmarked ? point(options.unknownId ? 2 : 1, true) : '';
    text += `BT /F1 12 Tf 50 700 Td (Page ${pageIndex + 1} meaningful content) Tj ET\n`;
    if (pageIndex === 1 && !options.missingEnd && !options.unmarked) text += point(options.unknownId ? 2 : 1, false);
    text += point(-1, true) + `BT /F1 12 Tf 50 30 Td (Footer ${pageIndex + 1}) Tj ET\n` + point(-1, false);
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(text)));
  }
  if (options.preexisting) pdf.catalog.set(PDFName.of('StructTreeRoot'), pdf.context.obj({ Type: 'StructTreeRoot' }));
  return pdf.save();
}

describe('genuine tagged PDF finishing', () => {
  it('writes a Unicode XMP title and language without declaring conformance', async () => {
    const title = 'Training & <examples> – résumé';
    const { bytes } = await finishTaggedPdf(await fixture(), { ...plan(), title });
    const pdf = await PDFDocument.load(bytes);
    const metadata = pdf.catalog.lookup(PDFName.of('Metadata'));
    if (!(metadata instanceof PDFRawStream)) throw new Error('Expected a saved XMP metadata stream.');
    expect(metadata.dict.get(PDFName.of('Type'))).toBe(PDFName.of('Metadata'));
    expect(metadata.dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('XML'));
    const text = new TextDecoder().decode(metadata.getContents());
    expect(pdf.getTitle()).toBe(title);
    expect(text).toContain('Training &amp; &lt;examples&gt; – résumé');
    expect(text).toContain('<dc:language><rdf:Bag><rdf:li>en-US</rdf:li>');
    expect(text).not.toContain('pdfuaid');
  });

  it('associates one semantic paragraph across pages with page-local MCIDs and artifact footers', async () => {
    const original = await fixture();
    const before = original.slice();
    const result = await finishTaggedPdf(original, plan());
    expect(original).toEqual(before);
    expect(result).toMatchObject({ pageCount: 2, associatedChunks: 2, artifactChunks: 2, contentPages: { 1: [0, 1] } });
    const pdf = await PDFDocument.load(result.bytes);
    const tree = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    const parents = tree.lookup(PDFName.of('ParentTree'), PDFDict).lookup(PDFName.of('Nums'), PDFArray);
    const document = pdf.context.lookup(tree.lookup(PDFName.of('K'), PDFArray).get(0), PDFDict);
    const paragraphRef = document.lookup(PDFName.of('K'), PDFArray).get(0);
    const paragraph = pdf.context.lookup(paragraphRef, PDFDict);
    expect(paragraph.lookup(PDFName.of('K'), PDFArray).size()).toBe(2);
    for (const [index, page] of pdf.getPages().entries()) {
      expect(page.node.lookup(PDFName.of('StructParents'), PDFNumber).asNumber()).toBe(index);
      const array = pdf.context.lookup(parents.get(index * 2 + 1), PDFArray);
      expect(array.size()).toBe(1);
      expect(array.get(0)).toEqual(paragraphRef);
      const raw = pdf.context.lookup(page.node.Contents());
      if (!(raw instanceof PDFRawStream)) throw new Error('Missing output content stream.');
      const text = new TextDecoder().decode(decodePDFRawStream(raw).decode());
      const operations = readPdfContent(text);
      expect(operations.filter(value => value.operator === 'BDC')).toHaveLength(1);
      expect(operations.filter(value => value.operator === 'BMC')).toHaveLength(1);
      expect(operations.filter(value => value.operator === 'EMC')).toHaveLength(2);
      expect(text).not.toContain('/DDTag');
    }
    expect(pdf.getTitle()).toBe('Training example');
    expect(pdf.catalog.lookup(PDFName.of('Lang'), PDFHexString).decodeText()).toBe('en-US');
  });

  it.each([
    [{ wrongNonce: true }, /identity does not match/],
    [{ missingEnd: true }, /open semantic block/],
    [{ unmarked: true }, /without a semantic or artifact scope/],
    [{ unknownId: true }, /Unknown tagged PDF source block/],
    [{ preexisting: true }, /Preexisting tags/],
  ] as const)('rejects invalid ownership and incomplete structural coverage %j', async (options, message) => {
    await expect(finishTaggedPdf(await fixture(options), plan())).rejects.toThrow(message);
  });

  it('captures plan and byte ownership before async PDF loading', async () => {
    const input = await fixture();
    const capturedPlan = plan();
    const pending = finishTaggedPdf(input, capturedPlan);
    capturedPlan.title = 'LATER MUTATION';
    capturedPlan.nodes[0].id = 99;
    input.fill(0);
    const pdf = await PDFDocument.load((await pending).bytes);
    expect(pdf.getTitle()).toBe('Training example');
  });

  it('rejects duplicate identities and figures without alternatives', async () => {
    const bytes = await fixture();
    const duplicate = plan();
    duplicate.nodes = [{ id: 1, role: 'P' }, { id: 1, role: 'H1' }];
    await expect(finishTaggedPdf(bytes, duplicate)).rejects.toThrow(/duplicate/);
    await expect(finishTaggedPdf(bytes, { ...plan(), nodes: [{ id: 1, role: 'Figure' }] })).rejects.toThrow(/alternative text/);
  });

  it('keeps repeated table headers out of logical reading order and preserves empty data cells', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const point = (id: number, begin: boolean) => `/DDTag << /N <${NONCE}> /I ${id} /B ${begin} >> DP\n`;
    for (let index = 0; index < 2; index++) {
      const page = pdf.addPage();
      const header = point(2, true) + 'BT /F1 12 Tf 50 700 Td (COLUMN HEADER) Tj ET\n' + point(2, false);
      const cell = index ? '' : point(4, true) + point(4, false);
      page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
      page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(header + cell)));
    }
    const table: PdfTaggingPlan = { ...plan(), nodes: [{ id: 0, role: 'Table', children: [
      { id: 1, role: 'TR', children: [{ id: 2, role: 'TH', columnHeader: true, repeatAsArtifact: true }] },
      { id: 3, role: 'TR', children: [{ id: 4, role: 'TD', allowEmpty: true }] },
    ] }] };
    const result = await finishTaggedPdf(await pdf.save(), table);
    expect(result).toMatchObject({ associatedChunks: 1, artifactChunks: 1, contentPages: { 2: [0] } });
    const output = await PDFDocument.load(result.bytes);
    const scoped = output.context.enumerateIndirectObjects().map(([, object]) => object).filter(object => object instanceof PDFDict && object.get(PDFName.of('S')) === PDFName.of('TH')) as PDFDict[];
    expect(scoped).toHaveLength(1);
    expect(scoped[0].lookup(PDFName.of('K'), PDFArray).size()).toBe(1);
    expect(scoped[0].lookup(PDFName.of('A'), PDFDict).get(PDFName.of('Scope'))).toBe(PDFName.of('Column'));
  });

  it('binds the actual painted image rather than accepting equal dimensions with different pixels', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const make = (bytes: number[]) => pdf.context.flateStream(new Uint8Array(bytes), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, BitsPerComponent: 8, ColorSpace: 'DeviceRGB' });
    const original = make([255, 0, 0]);
    const binding = await fingerprintPdfRaster(pdf.context, original);
    const actualRef = pdf.context.register(original);
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Im1: actualRef } }));
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(`/DDTag << /N <${NONCE}> /I 1 /B true >> DP\nq 50 0 0 50 20 20 cm /Im1 Do Q\n/DDTag << /N <${NONCE}> /I 1 /B false >> DP`)));
    const imagePlan: PdfTaggingPlan = { ...plan(), nodes: [{ id: 1, role: 'Figure', altText: 'A red square' }], images: { 1: binding } };
    expect((await finishTaggedPdf(await pdf.save(), imagePlan)).associatedChunks).toBe(1);
    pdf.context.assign(actualRef, make([0, 255, 0]));
    await expect(finishTaggedPdf(await pdf.save(), imagePlan)).rejects.toThrow(/does not match its owned source/);
    await expect(finishTaggedPdf(await pdf.save(), { ...imagePlan, images: {} })).rejects.toThrow(/explicit owned raster binding/);
  });
});
