import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { finishTaggedPdf, type PdfTaggingPlan } from '@/services/pdf/accessibility/taggedPdf';
import { readPdfContent } from '@/services/pdf/accessibility/contentStream';

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
});
