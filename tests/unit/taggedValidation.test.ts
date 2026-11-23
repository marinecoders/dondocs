import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, StandardFonts, decodePDFRawStream } from 'pdf-lib';
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

  it('rejects a generated PDF whose XMP metadata is missing', async () => {
    const pdf = await PDFDocument.load(await fixture());
    pdf.catalog.delete(name('Metadata'));
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow(/XMP metadata/);
  });

  it('rejects XMP that disagrees with the saved document title or language', async () => {
    const pdf = await PDFDocument.load(await fixture());
    pdf.setTitle('Changed document title');
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow(/XMP title or language/);
    pdf.setTitle('Training document');
    pdf.setLanguage('fr');
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow(/XMP title or language/);
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

  it('preserves empty data cells and rejects damaged table groups, column counts, scope, or cell attributes', async () => {
    const pdf = await PDFDocument.create(); const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    const nonce = 'b'.repeat(32);
    const point = (id: number, begin: boolean) => `/DDTag << /N <${nonce}> /I ${id} /B ${begin} >> DP\n`;
    page.node.set(name('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
    page.node.set(name('Contents'), pdf.context.register(pdf.context.flateStream(point(2, true)
      + 'BT /F1 12 Tf 40 700 Td (Column header) Tj ET\n' + point(2, false) + point(4, true) + point(4, false))));
    const output = await finishTaggedPdf(await pdf.save(), { nonce, title: 'Empty native table cell', language: 'en-US', nodes: [{ id: 0, role: 'Table', children: [
      { id: 5, role: 'THead', children: [{ id: 1, role: 'TR', children: [{ id: 2, role: 'TH', columnHeader: true }] }] },
      { id: 6, role: 'TBody', children: [{ id: 3, role: 'TR', children: [{ id: 4, role: 'TD', allowEmpty: true }] }] },
    ] }] });
    await expect(validateGeneratedTaggedPdf(output.bytes)).resolves.toMatchObject({ associatedChunks: 1, columnHeaders: 1 });
    const damaged = await PDFDocument.load(output.bytes);
    const tree = damaged.catalog.lookup(name('StructTreeRoot'), PDFDict);
    const root = tree.lookup(name('K'), PDFArray).lookup(0, PDFDict);
    const table = root.lookup(name('K'), PDFArray).lookup(0, PDFDict).lookup(name('K'), PDFArray);
    const header = table.get(0)!;
    table.set(0, table.get(1)!);
    table.set(1, header);
    await expect(validateGeneratedTaggedPdf(await damaged.save())).rejects.toThrow(/groups are out of order/);
    table.set(1, table.get(0)!);
    table.set(0, header);

    const bodyRows = table.lookup(1, PDFDict).lookup(name('K'), PDFArray);
    const bodyRow = bodyRows.get(0) as PDFRef;
    const cells = bodyRows.lookup(0, PDFDict).lookup(name('K'), PDFArray);
    cells.push(damaged.context.register(damaged.context.obj({ Type: 'StructElem', S: 'TD', P: bodyRow, K: [] })));
    await expect(validateGeneratedTaggedPdf(await damaged.save())).rejects.toThrow(/number of cells/);
    cells.remove(1);

    const headerRows = table.lookup(0, PDFDict).lookup(name('K'), PDFArray);
    const headerCell = headerRows.lookup(0, PDFDict).lookup(name('K'), PDFArray).lookup(0, PDFDict);
    const attributes = headerCell.lookup(name('A'), PDFDict);
    attributes.set(name('O'), name('Layout'));
    await expect(validateGeneratedTaggedPdf(await damaged.save())).rejects.toThrow(/header scope/);
    attributes.set(name('O'), name('Table'));
    attributes.set(name('ColSpan'), PDFNumber.of(2));
    await expect(validateGeneratedTaggedPdf(await damaged.save())).rejects.toThrow(/unsupported cell attributes/);
    attributes.delete(name('ColSpan'));
    cells.lookup(0, PDFDict).set(name('A'), damaged.context.obj({ O: 'Table', RowSpan: 2 }));
    await expect(validateGeneratedTaggedPdf(await damaged.save())).rejects.toThrow(/unsupported cell attributes/);
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
