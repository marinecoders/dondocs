import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';

async function source(width: number, height: number, rotation = 0) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([width, height]);
  page.setRotation(degrees(rotation));
  for (const [text, x, y] of [['LEFT EDGE', 18, 30], ['RIGHT EDGE', width - 150, height - 30]] as const) {
    page.drawText(text, { x, y, size: 12 });
  }
  return doc.save();
}

describe('I-Type enclosure geometry', () => {
  it.each([[1224, 792, 0], [792, 1224, 90], [612, 792, 0]])('keeps border-mode edge content visible (%s × %s, rotation %s)', async (width, height, rotation) => {
    const result = await mergeEnclosures(await source(612, 792), [{ number: 1, title: 'Drawing', data: (await source(width, height, rotation)).buffer as ArrayBuffer, pageStyle: 'border' }], undefined, false, [], { enclosureLabel: 'footer', header: { line1: 'MI 12345A-26/1', line2: '30 October 2026' } });
    expect(result.errors).toEqual([]);
    const pdf = await getDocument({ data: result.pdfBytes.slice() }).promise;
    try {
      const page = await pdf.getPage(2);
      const viewport = page.getViewport({ scale: 1 });
      const items = (await page.getTextContent()).items.filter((i) => 'str' in i && /EDGE/.test(i.str));
      expect(items).toHaveLength(2);
      for (const item of items) {
        if (!('str' in item)) continue;
        const [a, b, , , x, y] = item.transform;
        const length = Math.hypot(a, b);
        for (const [px, py] of [[x, y], [x + item.width * a / length, y + item.width * b / length]]) {
          expect(px).toBeGreaterThanOrEqual(72);
          expect(px).toBeLessThanOrEqual(viewport.width - 72);
          expect(py).toBeGreaterThanOrEqual(72);
          expect(py).toBeLessThanOrEqual(viewport.height - 72);
        }
      }
    } finally { await pdf.destroy(); }
  });
});
