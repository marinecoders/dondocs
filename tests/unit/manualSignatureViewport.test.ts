// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { placeManualSignatureFields, type ManualSignature } from '@/lib/manualSignatureFields';

const field: ManualSignature = {
  id: 'c12e9f43-f933-4c77-89e2-fb7e76b68843', signer: 'FICTIONAL SIGNER',
  page: 0, x: 0.2, y: 0.3, width: 0.35, height: 0.1,
};

describe('signature placement in the rendered PDF viewport', () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const crop of [[40, 50, 300, 500], [-20, -10, 350, 500]]) {
      it(`retains the selected visible rectangle at rotation ${rotation} and crop ${crop}`, async () => {
        const source = await PDFDocument.create();
        const sourcePage = source.addPage([400, 600]);
        sourcePage.setRotation(degrees(rotation));
        sourcePage.setCropBox(crop[0], crop[1], crop[2], crop[3]);
        const output = await placeManualSignatureFields(await source.save(), [field]);
        const parsed = await PDFDocument.load(output);
        const rectangle = parsed.getForm().getFields()[0].acroField.getWidgets()[0].getRectangle();
        const rendered = await getDocument({ data: new Uint8Array(output), useSystemFonts: false }).promise;
        try {
          const viewport = (await rendered.getPage(1)).getViewport({ scale: 1.75 });
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
            rectangle.x, rectangle.y, rectangle.x + rectangle.width, rectangle.y + rectangle.height,
          ]);
          expect(Math.min(x1, x2) / viewport.width).toBeCloseTo(field.x, 8);
          expect(Math.min(y1, y2) / viewport.height).toBeCloseTo(field.y, 8);
          expect(Math.abs(x2 - x1) / viewport.width).toBeCloseTo(field.width, 8);
          expect(Math.abs(y2 - y1) / viewport.height).toBeCloseTo(field.height, 8);
        } finally { await rendered.destroy(); }
      });
    }
  }
});
