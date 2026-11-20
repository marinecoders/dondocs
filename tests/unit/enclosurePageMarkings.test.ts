import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mergeEnclosures } from '@/services/pdf/mergeEnclosures';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';

async function sourcePdf(pages: number): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pages; index++) pdf.addPage([612, 792]).drawText(`Synthetic content ${index + 1}`, { x: 72, y: 500 });
  return new Uint8Array(await pdf.save());
}

describe('assembled enclosure page banners', () => {
  it('uses each enclosure declaration for every page and its added cover, preserving the originals', async () => {
    const main = await sourcePdf(1), source = await sourcePdf(2), original = source.slice();
    const result = await mergeEnclosures(main, [
      { number: 1, title: 'Public appendix', data: source.buffer, marking: { classLevel: 'unclassified' }, pageStyle: 'fullpage', hasCoverPage: true },
      { number: 2, title: 'Controlled appendix', data: source.buffer, marking: { classLevel: 'custom', customClassification: 'CUI//PRVCY' }, pageStyle: 'fit' },
      { number: 3, title: 'Inherited appendix', data: source.buffer },
    ], { level: 'secret', marking: 'SECRET' });
    expect(result.hasErrors).toBe(false);
    expect(source).toEqual(original);
    const { boxes } = await pdfTextLayout(result.pdfBytes);
    const banners = (page: number) => boxes.filter(box => box.page === page && ['UNCLASSIFIED', 'CUI//PRVCY', 'SECRET'].includes(box.text)).map(box => box.text);
    for (const page of [2, 3, 4]) expect(banners(page)).toEqual(['UNCLASSIFIED', 'UNCLASSIFIED']);
    for (const page of [5, 6]) expect(banners(page)).toEqual(['CUI//PRVCY', 'CUI//PRVCY']);
    for (const page of [7, 8]) expect(banners(page)).toEqual(['SECRET', 'SECRET']);
    expect(boxes.filter(box => box.text.includes('Synthetic content'))).toHaveLength(7);
  });
  it('rejects an incomplete custom declaration before producing unmarked pages', async () => {
    const main = await sourcePdf(1), source = await sourcePdf(1);
    await expect(mergeEnclosures(main, [{ number: 1, title: 'Incomplete', data: source.buffer, marking: { classLevel: 'custom' } }]))
      .rejects.toThrow(/marking text/);
  });
});
