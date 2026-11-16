import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { placeManualSignatureFields } from '@/lib/manualSignatureFields';

describe('exported signature field names', () => {
  it.each(['JOSÉ 王', 'ΑΛΕΞΑΝΔΡΟΣ', 'R EXAMPLE 🌊'])('preserves the assigned signer %s', async signer => {
    const source = await PDFDocument.create();
    source.addPage();
    const bytes = await placeManualSignatureFields(await source.save(), [{
      id: crypto.randomUUID(), signer, page: 0, x: 0.1, y: 0.5, width: 0.3, height: 0.1,
    }]);
    const exported = await PDFDocument.load(bytes);
    expect(exported.getForm().getFields()[0].getName()).toContain(signer);
  });
});
