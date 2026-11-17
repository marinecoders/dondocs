import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib';
import { finishTaggedPdf } from '@/services/pdf/accessibility/taggedPdf';
import { validateGeneratedTaggedPdf } from '@/services/pdf/accessibility/validate';

const name = (value: string) => PDFName.of(value);
async function fixture(options: { split?: boolean; repeated?: boolean } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const nonce = '9'.repeat(32);
  const marked = (id: number, paint: string) => `/DDTag << /N <${nonce}> /I ${id} /B true >> DP\n${paint}\n/DDTag << /N <${nonce}> /I ${id} /B false >> DP\n`;
  const diagram = marked(2, '50 500 20 20 re f');
  const contents = [marked(1, 'BT /F1 12 Tf 50 700 Td (Earlier body) Tj ET') + (options.split ? diagram : ''), diagram + (options.repeated ? diagram : '')];
  for (const text of contents) {
    const page = pdf.addPage([612, 792]);
    page.node.set(name('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
    page.node.set(name('Contents'), pdf.context.register(pdf.context.flateStream(text)));
  }
  const output = await finishTaggedPdf(await pdf.save(), { nonce, title: 'Figure hint validation', language: 'en-US', nodes: [{ id: 1, role: 'P' }, { id: 2, role: 'Figure', altText: 'A training diagram.' }] });
  const saved = await PDFDocument.load(output.bytes);
  const tree = saved.catalog.lookup(name('StructTreeRoot'), PDFDict);
  const document = saved.context.lookup(tree.lookup(name('K'), PDFArray).get(0), PDFDict);
  const children = document.lookup(name('K'), PDFArray);
  return { pdf: saved, paragraph: saved.context.lookup(children.get(0), PDFDict), figure: saved.context.lookup(children.get(1), PDFDict) };
}

describe('saved figure page hints', () => {
  it('accepts the actual matching later-page hint emitted by the writer', async () => {
    const { pdf, figure } = await fixture();
    expect(figure.get(name('Pg'))).toEqual(pdf.getPage(1).ref);
    expect(await validateGeneratedTaggedPdf(await pdf.save())).toMatchObject({ pages: 2, figures: 1, associatedChunks: 2 });
  });

  it('continues accepting historical files without the optional hint', async () => {
    const { pdf, figure } = await fixture();
    figure.delete(name('Pg'));
    await expect(validateGeneratedTaggedPdf(await pdf.save())).resolves.toMatchObject({ figures: 1 });
  });

  it('accepts multiple direct MCRs that all refer to the hinted page', async () => {
    const { pdf } = await fixture({ repeated: true });
    await expect(validateGeneratedTaggedPdf(await pdf.save())).resolves.toMatchObject({ associatedChunks: 3 });
  });

  it('rejects a present hint pointing at the wrong real page', async () => {
    const { pdf, figure } = await fixture();
    figure.set(name('Pg'), pdf.getPage(0).ref);
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow(/page context/);
  });

  it.each(['number', 'name', 'unrelated object'] as const)('rejects an invalid %s page hint', async kind => {
    const { pdf, figure } = await fixture();
    figure.set(name('Pg'), kind === 'number' ? PDFNumber.of(1) : kind === 'name' ? name('Page') : pdf.context.register(pdf.context.obj({ Type: 'XObject' })));
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow(/page context/);
  });

  it('rejects a single-page hint on a figure with MCRs across pages', async () => {
    const { pdf, figure } = await fixture({ split: true });
    expect(figure.has(name('Pg'))).toBe(false);
    figure.set(name('Pg'), pdf.getPage(1).ref);
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow(/page context/);
  });

  it('continues accepting an ambiguous multi-page figure without a hint', async () => {
    const { pdf, figure } = await fixture({ split: true });
    expect(figure.has(name('Pg'))).toBe(false);
    await expect(validateGeneratedTaggedPdf(await pdf.save())).resolves.toMatchObject({ figures: 1, associatedChunks: 3 });
  });

  it('rejects page hints on other roles outside the generated format', async () => {
    const { pdf, paragraph } = await fixture();
    paragraph.set(name('Pg'), pdf.getPage(0).ref);
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow(/page context/);
  });

  it('still rejects a figure without direct content instead of trusting its page hint', async () => {
    const { pdf, figure } = await fixture();
    figure.set(name('K'), pdf.context.obj([]));
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow(/empty|page context/);
  });
});
