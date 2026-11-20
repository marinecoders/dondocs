import { expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

it('keeps source content and inherited or explicit banners within rotated page geometry for every fit style', async () => {
  const main = await PDFDocument.create();
  main.addPage([612, 792]).drawText('Synthetic main');
  const source = await PDFDocument.create();
  for (const angle of [0, 90, 180, 270]) {
    const page = source.addPage([612, 792]);
    page.setRotation(degrees(angle));
    page.drawText(`EDGE_${angle}`, { x: 12, y: 775, size: 10 });
    page.drawText(`CENTER_${angle}`, { x: 230, y: 390, size: 10 });
  }
  const bytes = new Uint8Array(await source.save()), before = bytes.slice();
  const result = await mergeEnclosures(await main.save(), ['border', 'fullpage', 'fit'].map((pageStyle, index) => ({
    number: index + 1, title: 'Synthetic rotated enclosure', data: bytes.buffer,
    pageStyle: pageStyle as 'border' | 'fullpage' | 'fit',
    ...(index === 0 ? { marking: { classLevel: 'unclassified' as const } } : index === 1 ? { marking: { classLevel: 'custom' as const, customClassification: 'CUI//PRVCY' } } : {}),
  })), { level: 'secret', marking: 'SECRET' });
  expect(result.hasErrors, JSON.stringify(result.errors)).toBe(false);
  expect(bytes).toEqual(before);
  const output = await PDFDocument.load(result.pdfBytes);
  const { boxes } = await pdfTextLayout(result.pdfBytes);
  for (let page = 2; page <= 13; page++) {
    const expected = page <= 5 ? 'UNCLASSIFIED' : page <= 9 ? 'CUI//PRVCY' : 'SECRET';
    const content = boxes.filter(box => box.page === page);
    const size = output.getPage(page - 1).getSize();
    expect(content.every(box => box.left >= 0 && box.right <= size.width && box.bottom >= 0 && box.top <= size.height)).toBe(true);
    const banners = content.filter(box => box.text === expected);
    expect(banners).toHaveLength(2);
    expect(banners.every(box => box.left >= 23 && box.right <= output.getPage(page - 1).getWidth() - 23)).toBe(true);
    expect(content.some(box => box.text.startsWith('EDGE_'))).toBe(true);
    expect(content.some(box => box.text.startsWith('CENTER_'))).toBe(true);
  }
});
