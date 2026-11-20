import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';
import { volumeFixture } from '../_helpers/volumeFixture';
import { resolvePublicationDestinations } from '@/services/pdf/publicationDestinations';

describeToolchainRequirement('complete volume PDF');
describe.skipIf(!hasPdfToolchain)('complete volume PDF', () => {
  it.each([false, true])('renders complete linked volumes with dense content=%s', async dense => {
    const source = volumeFixture(dense);
    const compiled = await compileFixture(source);
    expect(compiled.ok, formatFailure('technical_volume', compiled)).toBe(true);
    const bytes = await resolvePublicationDestinations(compiled.pdfBytes!);
    const pdf = await PDFDocument.load(bytes);
    const { boxes } = await pdfTextLayout(bytes);
    const content = boxes.map(box => box.text).join(' ');
    for (const expected of ['QUALIFICATION VOLUME', 'Original introduction.', 'Daily checks', 'Measured values', 'Appendix content retained.', 'portable example controller.', `READBACK-${dense ? 80 : 2}`]) expect(content).toContain(expected);
    if (dense) {
      expect(content).toContain('Body record 60.');
      const headerPages = new Set(boxes.filter(box => box.text.includes('Measurement')).map(box => box.page));
      expect(headerPages.size).toBeGreaterThan(1);
    }
    expect(pdf.catalog.lookup(PDFName.of('PageLabels'))).toBeInstanceOf(PDFDict);
    expect(pdf.catalog.lookup(PDFName.of('Outlines'))).toBeInstanceOf(PDFDict);
    expect(boxes.filter(box => box.text.includes('Appendix content')).every(box => box.left >= 70 && box.right <= 542)).toBe(true);
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
    try {
      const reader = await task.promise;
      const labels = await reader.getPageLabels();
      expect(labels?.slice(0, 4)).toEqual(['Cover', 'i', 'ii', '1']);
      expect(labels?.slice(-2)).toEqual(['A-1', 'GL-1']);
      let linkCount = 0;
      for (let pageNumber = 1; pageNumber <= reader.numPages; pageNumber++) {
        const page = await reader.getPage(pageNumber);
        for (const annotation of await page.getAnnotations()) if (typeof annotation.dest === 'string' && annotation.dest.startsWith('volume.')) {
          expect(await reader.getDestination(annotation.dest), `Missing ${annotation.dest}`).toBeTruthy();
          linkCount++;
        }
      }
      expect(linkCount).toBeGreaterThanOrEqual(7);
    } finally { await task.destroy(); }
  }, 60_000);
  it('prints CUI banners on the cover and every body/appendix page', async () => {
    const source = volumeFixture();
    Object.assign(source.formData, { classLevel: 'cui', cuiControlledBy: 'Synthetic Office', cuiCategory: 'PRVCY', pocEmail: 'synthetic@example.invalid' });
    const result = await compileFixture(source);
    expect(result.ok, formatFailure('CUI volume', result)).toBe(true);
    const { boxes } = await pdfTextLayout(result.pdfBytes!);
    const pdf = await PDFDocument.load(result.pdfBytes!);
    for (let page = 1; page <= pdf.getPageCount(); page++) {
      const banners = boxes.filter(box => box.page === page && box.text.trim() === 'CUI');
      expect(banners.some(box => box.top > 720), `Missing top banner on page ${page}`).toBe(true);
      expect(banners.some(box => box.bottom < 50), `Missing bottom banner on page ${page}`).toBe(true);
    }
  });
});
