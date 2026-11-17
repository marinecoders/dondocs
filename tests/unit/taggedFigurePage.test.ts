import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib';
import { finishTaggedPdf, type PdfSemanticNode, type PdfTaggingPlan } from '@/services/pdf/accessibility/taggedPdf';

const NONCE = '1244f763b0aa4f0aa77572d0f335564b';
const figure = (id: number): PdfSemanticNode => ({ id, role: 'Figure', altText: 'An owned training diagram.' });
const point = (id: number, begin: boolean) => `/DDTag << /N <${NONCE}> /I ${id} /B ${begin} >> DP\n`;
const marked = (id: number, paint = '50 500 20 20 re f\n') => point(id, true) + paint + point(id, false);
const text = (value: string) => `BT /F1 12 Tf 50 700 Td (${value}) Tj ET\n`;

async function finish(pages: string[], nodes: readonly PdfSemanticNode[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const source of pages) {
    const page = pdf.addPage([612, 792]);
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(source)));
  }
  const plan: PdfTaggingPlan = { nonce: NONCE, title: 'Figure page context', language: 'en-US', nodes };
  return PDFDocument.load((await finishTaggedPdf(await pdf.save(), plan)).bytes);
}

function structure(pdf: PDFDocument) {
  const root = pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
  const document = pdf.context.lookup(root.lookup(PDFName.of('K'), PDFArray).get(0), PDFDict);
  const children = document.lookup(PDFName.of('K'), PDFArray);
  return { root, document, children };
}

function checkFigurePage(pdf: PDFDocument, childIndex: number, pageIndex: number, chunks: number) {
  const { root, children } = structure(pdf);
  const ref = children.get(childIndex);
  const element = pdf.context.lookup(ref, PDFDict);
  const page = pdf.getPage(pageIndex);
  expect(element.get(PDFName.of('Pg'))).toEqual(page.ref);
  const references = element.lookup(PDFName.of('K'), PDFArray);
  expect(references.size()).toBe(chunks);
  const numbers = root.lookup(PDFName.of('ParentTree'), PDFDict).lookup(PDFName.of('Nums'), PDFArray);
  const parents = pdf.context.lookup(numbers.get(pageIndex * 2 + 1), PDFArray);
  for (const entry of references.asArray()) {
    const mcr = pdf.context.lookup(entry, PDFDict);
    expect(mcr.get(PDFName.of('Pg'))).toEqual(page.ref);
    const id = mcr.lookup(PDFName.of('MCID'), PDFNumber).asNumber();
    expect(parents.get(id)).toEqual(ref);
  }
}

describe('figure page context in the saved structure', () => {
  it('binds a first-page figure without changing the document or paragraph page metadata', async () => {
    const pdf = await finish([marked(1) + marked(2, text('First-page paragraph'))], [figure(1), { id: 2, role: 'P' }]);
    checkFigurePage(pdf, 0, 0, 1);
    const { document, children } = structure(pdf);
    expect(document.has(PDFName.of('Pg'))).toBe(false);
    expect(pdf.context.lookup(children.get(1), PDFDict).has(PDFName.of('Pg'))).toBe(false);
  });

  it('uses the actual later page rather than the first page', async () => {
    const pdf = await finish([marked(2, text('Earlier body')), marked(1)], [{ id: 2, role: 'P' }, figure(1)]);
    checkFigurePage(pdf, 1, 1, 1);
  });

  it('retains every MCR and ParentTree association when a figure has multiple chunks on one page', async () => {
    const pdf = await finish([marked(1) + marked(1, '80 500 20 20 re f\n')], [figure(1)]);
    checkFigurePage(pdf, 0, 0, 2);
  });

  it('omits an ambiguous page hint for a figure with content on multiple pages', async () => {
    const pdf = await finish([marked(1), marked(1)], [figure(1)]);
    const { children } = structure(pdf);
    const element = pdf.context.lookup(children.get(0), PDFDict);
    expect(element.has(PDFName.of('Pg'))).toBe(false);
    const references = element.lookup(PDFName.of('K'), PDFArray);
    expect(references.size()).toBe(2);
    expect(pdf.context.lookup(references.get(0), PDFDict).get(PDFName.of('Pg'))).toEqual(pdf.getPage(0).ref);
    expect(pdf.context.lookup(references.get(1), PDFDict).get(PDFName.of('Pg'))).toEqual(pdf.getPage(1).ref);
  });

  it('leaves same-page table, row and cell metadata unchanged', async () => {
    const table: PdfSemanticNode = { id: 2, role: 'Table', children: [{ id: 3, role: 'TR', children: [{ id: 4, role: 'TH', columnHeader: true }, { id: 5, role: 'TD' }] }] };
    const pdf = await finish([marked(1) + marked(4, text('Header')) + marked(5, text('Cell'))], [figure(1), table]);
    checkFigurePage(pdf, 0, 0, 1);
    const { children } = structure(pdf);
    const tableElement = pdf.context.lookup(children.get(1), PDFDict);
    const row = pdf.context.lookup(tableElement.lookup(PDFName.of('K'), PDFArray).get(0), PDFDict);
    expect(tableElement.has(PDFName.of('Pg'))).toBe(false);
    expect(row.has(PDFName.of('Pg'))).toBe(false);
    for (const child of row.lookup(PDFName.of('K'), PDFArray).asArray()) expect(pdf.context.lookup(child, PDFDict).has(PDFName.of('Pg'))).toBe(false);
  });

  it('still rejects an empty figure instead of inventing an associated page', async () => {
    await expect(finish([marked(1, '')], [figure(1)])).rejects.toThrow(/no painted content/);
  });
});
