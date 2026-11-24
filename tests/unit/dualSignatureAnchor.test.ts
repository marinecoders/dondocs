import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { addDualSignatureFields, addTemplateSignatureFields } from '@/services/pdf/addSignatureField';
import { resolvePublicationDestinations } from '@/services/pdf/publicationDestinations';

async function fixture(roles: string[], pageIndex = 0) {
  const pdf = await PDFDocument.create();
  pdf.addPage();pdf.addPage();
  pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ Dests: { Names: roles.flatMap(role => [
    PDFString.of(`dondocs.signature.${role}`), [pdf.getPage(pageIndex).ref, 'XYZ', role === 'junior' ? 100 : 350, 300, null],
  ]) } }));
  return pdf.save();
}

it('requires both template slots instead of guessing from printed names', async () => {
  await expect(addDualSignatureFields(await fixture(['junior']), { requireTemplateAnchors: true }))
    .rejects.toThrow('senior signature location is missing');
  await expect(addDualSignatureFields(await fixture([]), { requireTemplateAnchors: true }))
    .rejects.toThrow('junior signature location is missing');
});

it('rejects signature slots outside the basic document', async () => {
  await expect(addDualSignatureFields(await fixture(['junior', 'senior'], 1), { requireTemplateAnchors: true, lastBasicPageIndex: 0 }))
    .rejects.toThrow('outside the basic document');
});

it('requires a generated annotation even when an inherited destination has the expected name', async () => {
  const pdf = await PDFDocument.load(await fixture(['junior']));
  const source = pdf.getPage(0);
  const marker = pdf.context.obj({
    Subtype: PDFName.of('Link'), NM: PDFString.of('dondocs.signature.junior'), Rect: [100, 300, 100, 300],
  });
  source.node.addAnnot(pdf.context.register(marker));
  await expect(resolvePublicationDestinations(await pdf.save(), false, { firstGeneratedPage: 1, roles: ['junior'] }))
    .rejects.toThrow('junior signature location is missing');
});

it('rejects overlapping signature rectangles and preserves the input', async () => {
  const source = await fixture(['middle', 'senior']);
  const before = source.slice();
  await expect(addTemplateSignatureFields(source, [
    { role: 'middle', name: 'MiddleSignature' }, { role: 'senior', name: 'SeniorSignature' },
  ], 0)).rejects.toThrow('Signature fields overlap');
  expect(source).toEqual(before);
});
