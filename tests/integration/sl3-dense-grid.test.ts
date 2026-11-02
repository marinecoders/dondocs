// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFString } from 'pdf-lib';
import { denseSl3Input } from '../_helpers/denseSl3';
import { renderToFile } from '../../companion/renderToFile';
import { validateLetter } from '../../companion/validateLetter';
import { pdfImages } from '../_helpers/pdfImages';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { pdfWordBoxes } from '../_helpers/pdfTableInsets';

it.each(['portrait', 'landscape'] as const)('fits every %s grid without losing items, captions or destinations', async orientation => {
  const root = await mkdtemp(join(tmpdir(), 'sl3-dense-'));
  for (const capacity of [1, 2, 4, 8, 12, 16] as const) {
    const input = await denseSl3Input(orientation, capacity);
    input.paragraphs![3].text = 'Training model BCDFGHJKLMNPQRSTVWXZBCDFGHJKLMNPQRSTVWXZBCDFGHJKLMNPQRSTVWXZ';
    expect(validateLetter(input)).toEqual([]);
    const result = await renderToFile(input, {}, root);
    const bytes = await readFile(result.path);
    const pdf = await PDFDocument.load(bytes);
    const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('Dests'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
    const destinations = new Map(Array.from({ length: names.size() / 2 }, (_, i) => [names.lookup(i * 2, PDFString).decodeText(), names.lookup(i * 2 + 1, PDFArray)]));
    const platePages = new Set<number>();
    for (let figure = 1; figure <= 31; figure++) {
      const ref = destinations.get(`sl3.figure.${figure}`)!.get(0)!.toString();
      const number = pdf.getPages().findIndex(p => p.ref.toString() === ref) + 1;
      expect(number).toBeGreaterThan(0);
      platePages.add(number);
    }
    const counts: number[] = [];
    const words = pdfWordBoxes(bytes);
    for (const number of platePages) {
      const images = await pdfImages(bytes, number);
      counts.push(images.length);
      const captions = words.filter(w => w.page === number && w.text === 'Figure');
      expect(captions).toHaveLength(images.length);
      const rows = new Map<number, number>();
      for (const caption of captions) rows.set(Math.round(caption.top), (rows.get(Math.round(caption.top)) ?? 0) + 1);
      const columns = capacity >= 8 ? 4 : capacity === 4 ? 2 : 1;
      expect(Math.max(...rows.values())).toBeLessThanOrEqual(columns);
      // Different aspect ratios share the same image-area center. Measure the
      // painted images to verify both full and partial rows are centered.
      const imageRows = new Map<number, typeof images>();
      for (const image of images) {
        const center = Math.round((image.top + image.bottom) / 2);
        imageRows.set(center, [...(imageRows.get(center) ?? []), image]);
      }
      expect([...imageRows.values()].map(r => r.length)).toEqual([...rows.values()]);
      for (const rowImages of imageRows.values()) {
        const centers = rowImages.map(image => (image.left + image.right) / 2);
        expect(centers.reduce((a,b) => a+b, 0) / centers.length).toBeCloseTo(pdf.getPage(number - 1).getWidth() / 2, 0);
      }
      if (images.length === 16) expect([...rows.values()]).toEqual([4, 4, 4, 4]);
      for (const a of images) {
        expect(a.left).toBeGreaterThan(17.5);
        expect(a.right).toBeLessThan(pdf.getPage(number - 1).getWidth() - 17.5);
        expect(a.bottom).toBeGreaterThan(61);
        expect((a.right - a.left) / (a.top - a.bottom)).toBeCloseTo(a.width / a.height, 3);
        for (const b of images) if (a !== b)
          expect(Math.min(a.right,b.right)-Math.max(a.left,b.left) < 0 || Math.min(a.top,b.top)-Math.max(a.bottom,b.bottom) < 0).toBe(true);
      }
    }
    const expected = [15, 16].flatMap(n => Array.from({ length: Math.ceil(n / capacity) }, (_, i) => Math.min(capacity, n - i * capacity)));
    expect(counts).toEqual(expected);
    const layout = await pdfTextLayout(bytes);
    expect(layout.collisions).toEqual([]);
    expect(layout.boxes.filter(b => b.left < 17.5 || b.right > pdf.getPage(b.page - 1).getWidth() - 17.5)).toEqual([]);
    expect(layout.boxes.map(b => b.text).join('').replace(/\s/g, '')).toContain('BCDFGHJKLMNPQRSTVWXZBCDFGHJKLMNPQRSTVWXZBCDFGHJKLMNPQRSTVWXZ');
    for (const number of platePages) for (const image of await pdfImages(bytes, number)) {
      expect(layout.boxes.filter(box => box.page === number &&
        Math.min(box.right, image.right) - Math.max(box.left, image.left) > 0.5 &&
        Math.min(box.top, image.top) - Math.max(box.bottom, image.bottom) > 0.5)).toEqual([]);
    }
  }
}, 240000);

it.each(['portrait', 'landscape'] as const)('centers one- and two-image final rows in the %s four-column grid', async orientation => {
  const root = await mkdtemp(join(tmpdir(), 'sl3-partial-'));
  for (const count of [5, 6]) {
    const input = await denseSl3Input(orientation, 16);
    input.publication!.sl3!.components = input.publication!.sl3!.components.slice(0, count);
    input.publication!.sl3!.artwork = input.publication!.sl3!.artwork.slice(0, count);
    input.paragraphs = input.paragraphs!.slice(0, count);
    input.attachments = input.attachments!.slice(0, count);
    const result = await renderToFile(input, {}, root);
    const bytes = await readFile(result.path);
    const pdf = await PDFDocument.load(bytes);
    const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict).lookup(PDFName.of('Dests'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
    const index = Array.from({length:names.size()/2}, (_,i) => i*2).find(i => names.lookup(i, PDFString).decodeText() === `sl3.figure.${count}`)!;
    const ref = names.lookup(index+1, PDFArray).get(0)!.toString();
    const page = pdf.getPages().findIndex(p => p.ref.toString() === ref)+1;
    const images = await pdfImages(bytes, page);
    expect(images).toHaveLength(count);
    const bottomRow = images.filter(image => Math.abs((image.top+image.bottom)/2 - Math.min(...images.map(i => (i.top+i.bottom)/2))) < 1);
    expect(bottomRow).toHaveLength(count-4);
    expect(bottomRow.reduce((n,i) => n+(i.left+i.right)/2, 0)/bottomRow.length).toBeCloseTo(pdf.getPage(page-1).getWidth()/2, 0);
    expect((await pdfTextLayout(bytes)).collisions).toEqual([]);
  }
}, 120000);
