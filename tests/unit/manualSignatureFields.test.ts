import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib';
import { addSignatureFieldToPage } from '@/services/pdf/signatureFieldCore';
import { inspectSigningPdf, placeManualSignatureFields, signaturePdfRectangle, type ManualSignature } from '@/lib/manualSignatureFields';

const field: ManualSignature = { id: '70475ed4-d441-48fa-aef1-c482b91ee722', signer: 'R. EXAMPLE', page: 0, x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
describe('manual signature PDF geometry', () => {
  it.each([
    [0, [30, 300, 90, 340]], [90, [50, 60, 70, 180]],
    [180, [130, 100, 190, 140]], [270, [150, 260, 170, 380]],
  ] as const)('maps rotated viewport positions to crop coordinates at %s degrees', (rotation, expected) => {
    const actual = signaturePdfRectangle(field, { x: 10, y: 20, width: 200, height: 400, rotation });
    actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]));
  });
  it('adds two independently assigned fields while preserving existing fields', async () => {
    const source = await PDFDocument.create();const page = source.addPage([400, 600]);page.setRotation(degrees(90));
    addSignatureFieldToPage(source, page, [20, 30, 120, 60], 'Existing signer');
    const output = await placeManualSignatureFields(await source.save(), [field, { ...field, id: crypto.randomUUID(), signer: 'SECOND SIGNER', x: 0.5 }]);
    const result = await PDFDocument.load(output), fields = result.getForm().getFields();
    expect(fields).toHaveLength(3);expect(fields[0].getName()).toBe('Existing signer');
    expect(fields[1].getName()).toContain('R  EXAMPLE');
    const rect = fields[1].acroField.getWidgets()[0].getRectangle();
    expect(rect.x).toBeCloseTo(80);expect(rect.y).toBeCloseTo(60);
    expect(rect.width).toBeCloseTo(40);expect(rect.height).toBeCloseTo(180);
  });
  it('intersects CropBox with MediaBox as the viewer does', async () => {
    const pdf = await PDFDocument.create();const page = pdf.addPage([400, 600]);page.setCropBox(-20, -10, 350, 500);
    expect((await inspectSigningPdf(await pdf.save())).pages[0]).toEqual({ x: 0, y: 0, width: 330, height: 490, rotation: 0 });
  });
  it('can retain an existing automatic field without adding a duplicate', async () => {
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    addSignatureFieldToPage(pdf, page, [10, 20, 100, 50], 'Automatic signer');
    const output = await placeManualSignatureFields(await pdf.save(), [], crypto.randomUUID());
    expect((await inspectSigningPdf(output)).existingSignatureNames).toEqual(['Automatic signer']);
  });
  it('rejects unsupported units, signatures, corrupt files, missing pages and overflowing boxes', async () => {
    const pdf = await PDFDocument.create();const page = pdf.addPage();
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
    await expect(inspectSigningPdf(await pdf.save())).rejects.toThrow('nonstandard');
    page.node.delete(PDFName.of('UserUnit'));
    addSignatureFieldToPage(pdf, page, [10, 20, 100, 50], 'Signed');
    pdf.getForm().getFields()[0].acroField.dict.set(PDFName.of('V'), pdf.context.obj({ ByteRange: [0, 1, 2, 3] }));
    await expect(inspectSigningPdf(await pdf.save())).rejects.toThrow('already contains');
    await expect(inspectSigningPdf(new Uint8Array([1, 2, 3]))).rejects.toThrow();
    const clean = await PDFDocument.create();clean.addPage();const bytes = await clean.save();
    await expect(placeManualSignatureFields(bytes, [{ ...field, page: 4 }])).rejects.toThrow('missing page');
    await expect(placeManualSignatureFields(bytes, [{ ...field, x: 0.9 }])).rejects.toThrow('fit entirely');
    await expect(placeManualSignatureFields(bytes, [field, field])).rejects.toThrow('unique');
  });
});
