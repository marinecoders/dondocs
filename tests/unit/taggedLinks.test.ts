import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts } from 'pdf-lib';
import { finishTaggedPdf, type PdfTaggingPlan } from '@/services/pdf/accessibility/taggedPdf';
import { taggedReferenceUrl } from '@/services/pdf/accessibility/links';
import { validateGeneratedTaggedPdf } from '@/services/pdf/accessibility/validate';

const name = PDFName.of;
const nonce = 'a'.repeat(32);
const url = 'https://example.test/reference?chapter=1&section=2';
const plan: PdfTaggingPlan = { nonce, title: 'Reference training', language: 'en-US', nodes: [{ id: 0, role: 'Link', linkUrl: url }] };
async function fixture(uri = url, owned = true) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 2; index++) {
    const page = pdf.addPage();
    const marker = (begin: boolean) => `/DDTag << /N <${nonce}> /I 0 /B ${begin} >> DP\n`;
    page.node.set(name('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
    page.node.set(name('Contents'), pdf.context.register(pdf.context.flateStream(`${marker(true)}BT /F1 12 Tf 40 700 Td (Training reference part ${index}) Tj ET\n${marker(false)}`)));
    const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [40, 690, 200, 710], A: { S: 'URI', URI: PDFString.of(uri) },
      ...(owned ? { DDTagLink: PDFHexString.of(nonce), DDTagId: 0 } : {}) });
    page.node.set(name('Annots'), pdf.context.obj([pdf.context.register(annotation)]));
  }
  return pdf.save();
}
async function output() { return (await finishTaggedPdf(await fixture(), plan)).bytes; }
function link(pdf: PDFDocument) { return pdf.getPage(0).node.Annots()!.lookup(0, PDFDict); }

describe('tagged external reference links', () => {
  it('encodes international URI actions and refuses unsafe schemes', () => {
    expect(taggedReferenceUrl('https://example.test/café?q=naïve')).toBe('https://example.test/caf%C3%A9?q=na%C3%AFve');
    expect(taggedReferenceUrl('javascript:alert(1)')).toBeNull();
  });
  it('binds a link crossing pages to both saved annotations and marked text', async () => {
    const bytes = await output();
    await expect(validateGeneratedTaggedPdf(bytes)).resolves.toMatchObject({ pages: 2, associatedChunks: 2 });
    const pdf = await PDFDocument.load(bytes);
    const tree = pdf.catalog.lookup(name('StructTreeRoot'), PDFDict);
    expect(tree.lookup(name('ParentTree'), PDFDict).lookup(name('Nums'), PDFArray).size()).toBe(8);
    expect(tree.lookup(name('ParentTreeNextKey'), PDFNumber).asNumber()).toBe(4);
    expect(link(pdf).has(name('DDTagLink'))).toBe(false);
    expect(link(pdf).lookup(name('StructParent'), PDFNumber).asNumber()).toBe(2);
  });
  it('rejects annotations whose destination or nonce does not match the source', async () => {
    await expect(finishTaggedPdf(await fixture('https://other.test/'), plan)).rejects.toThrow(/owned source/);
    await expect(finishTaggedPdf(await fixture(url, false), plan)).rejects.toThrow(/owned source/);
  });
  it('rejects UTF-16 URI strings that PDF.js cannot expose as usable destinations', async () => {
    const pdf = await PDFDocument.load(await fixture());
    link(pdf).lookup(name('A'), PDFDict).set(name('URI'), PDFHexString.fromText(url));
    await expect(finishTaggedPdf(await pdf.save(), plan)).rejects.toThrow(/encoded ASCII/);
  });
  it('rejects active content and unsafe URI actions', async () => {
    const pdf = await PDFDocument.load(await fixture());
    link(pdf).set(name('AA'), pdf.context.obj({ E: { S: 'JavaScript' } }));
    await expect(finishTaggedPdf(await pdf.save(), plan)).rejects.toThrow(/plain URI/);
    await expect(finishTaggedPdf(await fixture('javascript:alert(1)'), plan)).rejects.toThrow(/unsafe/);
  });
  it.each([1, 2, 32, 256])('rejects invisible link annotation flags: %s', async flags => {
    for (const finished of [false, true]) {
      const pdf = await PDFDocument.load(finished ? await output() : await fixture());
      link(pdf).set(name('F'), PDFNumber.of(flags));
      const bytes = await pdf.save();
      await expect(finished ? validateGeneratedTaggedPdf(bytes) : finishTaggedPdf(bytes, plan)).rejects.toThrow(/visible/);
    }
  });
  it('rejects links whose visibility depends on optional content', async () => {
    for (const finished of [false, true]) {
      const pdf = await PDFDocument.load(finished ? await output() : await fixture());
      link(pdf).set(name('OC'), pdf.context.obj({ Type: 'OCG', Name: PDFString.of('Hidden layer') }));
      const bytes = await pdf.save();
      await expect(finished ? validateGeneratedTaggedPdf(bytes) : finishTaggedPdf(bytes, plan)).rejects.toThrow(/visible/);
    }
  });
  it.each(['orphan', 'backlink', 'description', 'action'] as const)('rejects saved annotation corruption: %s', async kind => {
    const pdf = await PDFDocument.load(await output());
    const annotation = link(pdf);
    if (kind === 'orphan') pdf.getPage(0).node.set(name('Annots'), pdf.context.obj([]));
    if (kind === 'backlink') annotation.set(name('StructParent'), PDFNumber.of(0));
    if (kind === 'description') annotation.set(name('Contents'), PDFHexString.fromText('different destination'));
    if (kind === 'action') annotation.lookup(name('A'), PDFDict).set(name('Next'), pdf.context.obj({ S: 'JavaScript' }));
    await expect(validateGeneratedTaggedPdf(await pdf.save())).rejects.toThrow();
  });
  it.each(['outside', 'cropped', 'partly outside', 'outside within tolerance'] as const)('rejects inaccessible interactive rectangles: %s', async kind => {
    for (const finished of [false, true]) {
      const pdf = await PDFDocument.load(finished ? await output() : await fixture());
      if (kind === 'outside') link(pdf).set(name('Rect'), pdf.context.obj([-1000, -1000, -900, -900]));
      if (kind === 'outside within tolerance') link(pdf).set(name('Rect'), pdf.context.obj([-0.8, 690, -0.2, 710]));
      if (kind === 'partly outside') link(pdf).set(name('Rect'), pdf.context.obj([-50, 690, 200, 710]));
      if (kind === 'cropped') pdf.getPage(0).setCropBox(300, 0, 200, 800);
      const bytes = await pdf.save();
      await expect(finished ? validateGeneratedTaggedPdf(bytes) : finishTaggedPdf(bytes, plan)).rejects.toThrow(/visible page bounds/);
    }
  });
  it('rejects painted Link nodes without an annotation', async () => {
    const pdf = await PDFDocument.load(await fixture());
    for (const page of pdf.getPages()) page.node.delete(name('Annots'));
    await expect(finishTaggedPdf(await pdf.save(), plan)).rejects.toThrow(/cover their painted/);
  });
});
