import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { addDualSignatureFields } from '@/services/pdf/addSignatureField';

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
