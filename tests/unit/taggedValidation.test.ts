import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { finishTaggedPdf } from '@/services/pdf/accessibility/taggedPdf';
import { validateGeneratedTaggedPdf } from '@/services/pdf/accessibility/validate';
import { byteString, readPdfContent } from '@/services/pdf/accessibility/contentStream';

async function fixture() {
  const pdf = await PDFDocument.create(); const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  const nonce = 'a'.repeat(32);
  const block = (id: number, text: string) => `/DDTag << /N <${nonce}> /I ${id} /B true >> DP\nBT /F1 12 Tf 40 700 Td (${text}) Tj ET\n/DDTag << /N <${nonce}> /I ${id} /B false >> DP\n`;
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(block(1, 'Subject') + block(2, 'Meaningful body') + block(-1, '1'))));
  return (await finishTaggedPdf(await pdf.save(), { nonce, title: 'Training document', language: 'en-US', nodes: [{ id: 1, role: 'H1' }, { id: 2, role: 'P' }] })).bytes;
}
const name = (key: string) => PDFName.of(key);

describe('saved tagged PDF readback validation', () => {
  it('reparses actual saved content and verifies every forward/backlink and painted scope', async () => {
    expect(await validateGeneratedTaggedPdf(await fixture())).toEqual({ kind: 'generated-structure-check', pages: 1, structureElements: 3,
      associatedChunks: 2, artifactChunks: 1, paintedOperations: 3, figures: 0, columnHeaders: 0, conformance: 'PDF/UA not established' });
  });

  it('rejects a damaged ParentTree backlink even when marked metadata remains present', async () => {
    const pdf = await PDFDocument.load(await fixture());
    const tree = pdf.catalog.lookup(name('StructTreeRoot'), PDFDict);
    const parents = tree.lookup(name('ParentTree'), PDFDict).lookup(name('Nums'), PDFArray).lookup(1, PDFArray);
    parents.set(0, parents.get(1)!);
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow(/backlink/);
  });

  it('rejects an emptied generated paragraph even when other chunks still paint', async () => {
    const pdf = await PDFDocument.load(await fixture());
    const page = pdf.getPage(0);
    const stream = pdf.context.lookup(page.node.get(name('Contents')));
    if (!(stream instanceof PDFRawStream)) throw new Error('Expected the generated page content stream.');
    const source = byteString(decodePDFRawStream(stream).decode());
    const operations = readPdfContent(source);
    const begin = operations.findIndex(operation => operation.operator === 'BDC' && operation.operands[0]?.value === 'P');
    const end = operations.findIndex((operation, index) => index > begin && operation.operator === 'EMC');
    const paint = operations.slice(begin + 1, end).filter(operation => operation.operator === 'Tj');
    expect(paint).toHaveLength(1);
    const empty = source.slice(0, paint[0].start) + source.slice(paint[0].end);
    page.node.set(name('Contents'), pdf.context.register(pdf.context.flateStream(empty)));
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow(/associated marked content has no painted operation/);
  });

  it('preserves genuinely empty table data cells with no associated marked-content chunk', async () => {
    const pdf = await PDFDocument.create(); const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    const nonce = 'b'.repeat(32);
    const point = (id: number, begin: boolean) => `/DDTag << /N <${nonce}> /I ${id} /B ${begin} >> DP\n`;
    page.node.set(name('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
    page.node.set(name('Contents'), pdf.context.register(pdf.context.flateStream(point(2, true)
      + 'BT /F1 12 Tf 40 700 Td (Column header) Tj ET\n' + point(2, false) + point(4, true) + point(4, false))));
    const output = await finishTaggedPdf(await pdf.save(), { nonce, title: 'Empty native table cell', language: 'en-US', nodes: [{ id: 0, role: 'Table', children: [
      { id: 1, role: 'TR', children: [{ id: 2, role: 'TH', columnHeader: true }] },
      { id: 3, role: 'TR', children: [{ id: 4, role: 'TD', allowEmpty: true }] },
    ] }] });
    await expect(validateGeneratedTaggedPdf(output.bytes)).resolves.toMatchObject({ associatedChunks: 1, columnHeaders: 1 });
  });

  it('rejects orphaned page MCIDs and unscoped painted operators', async () => {
    const bytes = await fixture();
    const orphaned = await PDFDocument.load(bytes);
    orphaned.getPage(0).node.set(name('StructParents'), PDFNumber.of(99));
    await expect(validateGeneratedTaggedPdf(await orphaned.save())).rejects.toThrow(/page structure keys/);
    const unscoped = await PDFDocument.load(bytes);
    const page = unscoped.getPage(0); const existing = page.node.Contents()!;
    page.node.set(name('Contents'), unscoped.context.obj([existing, unscoped.context.register(unscoped.context.flateStream('0 0 m 10 10 l S'))]));
    await expect(validateGeneratedTaggedPdf(await unscoped.save())).rejects.toThrow(/outside structure/);
  });

  it('rejects MarkInfo-only metadata without genuine structure', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage().drawText('Searchable is not tagged.'); pdf.setTitle('Title');
    pdf.catalog.set(name('MarkInfo'), pdf.context.obj({ Marked: true }));
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow();
  });
});
