import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { addSignatureField } from '@/services/pdf/addSignatureField';

describe('publication signature placement', () => {
  it('rejects a publication with a missing signature slot instead of guessing', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({
      Dests: { Names: [PDFString.of('itype.authentication'), [page.ref, PDFName.of('XYZ'), 72, 700, null]] },
    }));
    await expect(addSignatureField(await pdf.save(), { signatoryName: 'J. A. DOE' })).rejects.toThrow('I-Type signature location is missing');
  });

  it('retains correspondence fallback inside the basic-document boundary', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
    const result = await PDFDocument.load(await addSignatureField(await pdf.save(), { lastBasicPageIndex: 0 }));
    const widget = result.getForm().getFields()[0].acroField.getWidgets()[0];
    expect(widget.P()?.toString()).toBe(result.getPage(0).ref.toString());
    expect(widget.getRectangle()).toEqual({ x: 304, y: 288, width: 144, height: 36 });
  });
});
