// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFString } from 'pdf-lib';
import { companionSl3 } from '../_helpers/companionSl3';
import { sl3Fixture } from '../_helpers/sl3Fixture';
import { renderToFile } from '../../companion/renderToFile';
import { pdfWordBoxes } from '../_helpers/pdfTableInsets';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { pdfImages } from '../_helpers/pdfImages';

it.each(['portrait', 'landscape'] as const)('packs four mixed-aspect %s images with aligned captions and live figure destinations', async orientation => {
  const root = await mkdtemp(join(tmpdir(), 'sl3-grid-'));
  const input = companionSl3();
  const sl3 = sl3Fixture(4).formData.sl3!;
  Object.assign(sl3, { orientation, rowsPerSheet: 5, illustrationsPerPage: 4 });
  input.publication!.sl3 = sl3;
  const sizes = [[600, 1200], [1600, 400], [1200, 800], [1000, 1000]];
  input.paragraphs = [];
  input.attachments = [];
  for (const [i, [width, height]] of sizes.entries()) {
    const id = String(i + 1).padStart(32, '0');
    sl3.components[i].figureId = id;
    sl3.artwork.push({ figureId: id, lettering: 'labels', labels: [{ id: `label-${i}`, text: `INERT ${i + 1}`, x: 50, y: 50 }] });
    input.paragraphs.push({ referenceId: id, text: `Training view ${i + 1} with a descriptive caption that wraps safely in the compact column`, figure: { fileId: id } });
    input.attachments.push({ id, name: `photo-${i}.png`, mimeType: 'image/png', dataBase64: (await sharp({ create: { width, height, channels: 3, background: 'white' } }).png().toBuffer()).toString('base64') });
  }
  const pageCounts = [];
  for (const perPage of [4, 2, 1, 8, 12, 16] as const) {
    sl3.illustrationsPerPage = perPage;
    input.out = `grid-${perPage}.pdf`;
    const result = await renderToFile(input, {}, root);
    const bytes = await readFile(result.path);
    const pdf = await PDFDocument.load(bytes);
    const words = pdfWordBoxes(bytes);
    const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('Dests'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
    const figurePages: number[] = [];
    for (let figure = 1; figure <= 4; figure++) {
      const index = Array.from({length: names.size() / 2}, (_, n) => n * 2).find(n => names.lookup(n, PDFString).decodeText() === `sl3.figure.${figure}`)!;
      const ref = names.lookup(index + 1, PDFArray).get(0)!.toString();
      const page = pdf.getPages().findIndex(p => p.ref.toString() === ref) + 1;
      expect(page).toBeGreaterThan(0);
      expect(words.some(w => w.page === page && w.text === 'INERT')).toBe(true);
      figurePages.push(page);
    }
    expect(new Set(figurePages).size).toBe(Math.ceil(4 / perPage));
    for (const page of new Set(figurePages)) {
      const images = await pdfImages(bytes, page);
      expect(images).toHaveLength(Math.min(perPage, 4));
      for (const image of images) {
        expect((image.right - image.left) / (image.top - image.bottom)).toBeCloseTo(image.width / image.height, 3);
        expect(image.left).toBeGreaterThan(17.5);
        expect(image.right).toBeLessThan(pdf.getPage(page - 1).getWidth() - 17.5);
        expect(image.bottom).toBeGreaterThan(61);
      }
      if (perPage === 4) {
        const captions = words.filter(w => w.page === page && w.text === 'Figure').sort((a,b) => b.top - a.top || a.left - b.left);
        expect(captions).toHaveLength(4);
        expect(captions[0].top).toBeCloseTo(captions[1].top, 1);
        expect(captions[2].top).toBeCloseTo(captions[3].top, 1);
        expect(captions[0].top - captions[2].top).toBeGreaterThan(180);
        for (const a of images) for (const b of images) if (a !== b)
          expect(Math.min(a.right,b.right)-Math.max(a.left,b.left) < 0 || Math.min(a.top,b.top)-Math.max(a.bottom,b.bottom) < 0).toBe(true);
      }
    }
    const layout = await pdfTextLayout(bytes);
    expect(layout.collisions).toEqual([]);
    pageCounts.push(pdf.getPageCount());
  }
  expect(pageCounts[2] - pageCounts[0]).toBe(3);
  expect(pageCounts[1] - pageCounts[0]).toBe(1);
  if (orientation === 'portrait') {
    sl3.illustrationsPerPage = 4;
    input.paragraphs[0].text = 'Overlong caption for the training component. '.repeat(200);
    await expect(renderToFile(input, {}, root)).rejects.toThrow(/illustration row exceeds one page/);
  }
}, 120000);
