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
  it('rejects an added wrapper before the identified source document', async () => {
    const result = await mergeEnclosures(await source(612, 792), [{ number: 1, title: 'Drawing', data: (await source(612, 792)).buffer as ArrayBuffer, hasCoverPage: true }], undefined, false, [], { enclosureLabel: 'footer' });
    expect(result.hasErrors).toBe(true);
    expect(result.errors[0].error).toContain('Remove the added enclosure cover page');
  });

  it.each(['border', 'fit', 'fullpage'] as const)('reserves added margin data outside source content in %s mode', async (pageStyle) => {
    const attachment = await PDFDocument.create();
    const sheet = attachment.addPage([612, 792]);
    sheet.drawText('SOURCE HEADER', { x: 200, y: 734, size: 12 });
    sheet.drawText('SOURCE FOOTER', { x: 270, y: 36, size: 12 });
    const result = await mergeEnclosures(await source(612, 792), [{ number: 1, title: 'Source document', data: (await attachment.save()).buffer as ArrayBuffer, pageStyle }], undefined, false, [], { enclosureLabel: 'footer', header: { line1: 'MI 12345A-26/1', line2: '' } });
    expect(result.errors).toEqual([]);
    const pdf = await getDocument({ data: result.pdfBytes.slice() }).promise;
    try {
      const page = await pdf.getPage(2);
      const items = (await page.getTextContent()).items.filter((i) => 'str' in i && i.str.startsWith('SOURCE'));
      expect(items).toHaveLength(2);
      for (const item of items) {
        if (!('str' in item)) continue;
        expect(item.transform[5]).toBeGreaterThanOrEqual(72);
        expect(item.transform[5] + item.height).toBeLessThanOrEqual(792 - 72);
      }
    } finally { await pdf.destroy(); }
  });

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
