// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { populatedSl4Input } from '../_helpers/populatedSl4';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { pdfTableInsets, pdfWordBoxes } from '../_helpers/pdfTableInsets';
import { renderToFile } from '../../companion/renderToFile';
import { validateLetter } from '../../companion/validateLetter';
import { SL4_TABLE_GRIDS } from '@/data/techpub/sl4Layout';
import sharp from 'sharp';
import { pdfImages } from '../_helpers/pdfImages';

it('preserves PNG and JPEG proportions, searchable labels and caption clearance on every plate', async () => {
  const input = await populatedSl4Input();
  const sizes = [[600, 1200], [1600, 400], [1200, 800], [1000, 1000], [2400, 600]];
  for (const [i, [width, height]] of sizes.entries()) {
    const jpeg = i % 2 === 1;
    const raster = sharp({ create: { width, height, channels: 3, background: '#dddddd' } });
    const data = await (jpeg ? raster.jpeg() : raster.png()).toBuffer();
    Object.assign(input.attachments![i], { name: `synthetic-${i}.${jpeg ? 'jpg' : 'png'}`, mimeType: jpeg ? 'image/jpeg' : 'image/png', dataBase64: data.toString('base64') });
    const artwork = input.publication!.sl4!.artwork.find(art => art.figureId === input.paragraphs![i].referenceId)!;
    artwork.lettering = 'labels';
    artwork.labels = [{ id: `raster-label-${i}`, text: `MOCK${i + 1}`, x: 50, y: 50 }];
  }
  expect(validateLetter(input)).toEqual([]);
  const root = await mkdtemp(join(tmpdir(), 'sl4-raster-'));
  const bytes = await readFile((await renderToFile(input, {}, root)).path);
  const pdf = await PDFDocument.load(bytes);
  const words = pdfWordBoxes(bytes);
  const layout = await pdfTextLayout(bytes);
  expect(layout.collisions).toEqual([]);
  for (const [i, [width, height]] of sizes.entries()) {
    const labels = words.filter(word => word.text === `MOCK${i + 1}`);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const images = await pdfImages(bytes, label.page);
      expect(images).toHaveLength(1);
      const image = images[0];
      expect((image.right - image.left) / (image.top - image.bottom)).toBeCloseTo(width / height, 3);
      expect(image.left).toBeGreaterThan(17.5);
      expect(image.right).toBeLessThan(pdf.getPage(label.page - 1).getWidth() - 17.5);
      expect(image.bottom).toBeGreaterThan(61);
      expect(label.left).toBeGreaterThanOrEqual(image.left);
      expect(label.right).toBeLessThanOrEqual(image.right);
      const caption = words.find(word => word.page === label.page && word.text === 'Figure')!;
      expect(image.bottom - caption.top).toBeGreaterThan(12);
    }
  }
}, 60000);

it('wraps long custom abbreviations and technical tokens inside the page margins', async () => {
  const input = await populatedSl4Input();
  input.publication!.sl4!.definitions.push({
    id: 'long-definition', term: 'LONGTECHNICALTERM'.repeat(12),
    meaning: 'A synthetic identifier: ' + 'TRAINING-IDENTIFIER'.repeat(14), portionMarking: 'U',
  });
  expect(validateLetter(input)).toEqual([]);
  const root = await mkdtemp(join(tmpdir(), 'sl4-long-definition-'));
  const bytes = await readFile((await renderToFile(input, {}, root)).path);
  const pdf = await PDFDocument.load(bytes);
  const layout = await pdfTextLayout(bytes);
  expect(layout.collisions).toEqual([]);
  expect(layout.boxes.filter(box => box.left < 17.5 || box.right > pdf.getPage(box.page - 1).getWidth() - 17.5)).toEqual([]);
}, 60000);

it.each(['cui', 'secret'] as const)('fits synthetic %s markings, cover overflow and long authentication fields', async level => {
  const input = await populatedSl4Input();
  input.classification = {
    level, basis: 'original', classifiedBy: 'Synthetic reviewer, Example Program Office',
    reason: '1.4(a)', declassifyOn: '20361030',
    cui: { controlledBy: 'EXAMPLE COMMAND', category: 'CTI', dissemination: 'NOFORN' },
  };
  input.publication!.distribution = { statement: 'D', reason: 'Software Documentation', date: '2026-10-30' };
  input.publication!.sl4!.contextPortion = level === 'secret' ? 'S' : 'CUI';
  const first = input.publication!.sl4!.rows.find(row => row.kind === 'part')!;
  if (first.kind === 'part') first.portionMarking = level === 'secret' ? 'S' : 'CUI';
  input.unit!.address = '100 DEMONSTRATION WAY\nBUILDING 100\nEXAMPLE CITY VA 00000';
  input.signature = { first: 'Example', last: 'Training-Reviewer', title: 'Program Manager, Training Equipment and Maintenance Systems' };
  input.publication!.controllingOffice = 'Training Equipment and Expeditionary Maintenance Program Office';
  input.publication!.endItems = Array.from({ length: 7 }, (_, i) => ({ ...input.publication!.endItems![0], model: `TRAINING MODEL ${i + 1}` }));
  expect(validateLetter(input)).toEqual([]);
  const root = await mkdtemp(join(tmpdir(), 'sl4-synthetic-markings-'));
  const bytes = await readFile((await renderToFile(input, {}, root)).path);
  const pdf = await PDFDocument.load(bytes);
  const layout = await pdfTextLayout(bytes);
  expect(layout.collisions).toEqual([]);
  expect(layout.boxes.filter(box => box.left < 17.5 || box.right > pdf.getPage(box.page - 1).getWidth() - 17.5
    || box.bottom < 17.5 || box.top > pdf.getPage(box.page - 1).getHeight() - 17.5)).toEqual([]);
  const banner = level === 'cui' ? 'CUI//NOFORN' : 'SECRET';
  for (let page = 1; page <= pdf.getPageCount(); page++) {
    expect(layout.boxes.filter(box => box.page === page && box.text.includes(banner)).length, `page ${page}`).toBeGreaterThanOrEqual(2);
  }
  const words = pdfWordBoxes(bytes);
  expect(words.some(word => word.text === '7' && word.page === 2)).toBe(true);
  const widget = pdf.getForm().getField('Signature1').acroField.getWidgets()[0];
  const signaturePage = pdf.getPages().findIndex(page => page.ref.toString() === widget.P()?.toString()) + 1;
  expect(signaturePage).toBe(3);
  const rect = widget.getRectangle();
  expect(words.filter(word => word.page === signaturePage && Math.min(word.right, rect.x + rect.width) - Math.max(word.left, rect.x) > 0.5
    && Math.min(word.top, rect.y + rect.height) - Math.max(word.bottom, rect.y) > 0.5)).toEqual([]);
}, 60000);

it.each(['A', 'D'] as const)('fits the complete illustrated Distribution %s SL-4 with working links and clear table margins', async statement => {
  const input = await populatedSl4Input();
  input.publication!.distribution = statement === 'A' ? { statement }
    : { statement, reason: 'Software Documentation', date: '2026-10-28' };
  expect(validateLetter(input)).toEqual([]);
  const root = await mkdtemp(join(tmpdir(), 'sl4-populated-'));
  const bytes = await readFile((await renderToFile(input, {}, root)).path);
  const pdf = await PDFDocument.load(bytes);
  const words = pdfWordBoxes(bytes);
  const layout = await pdfTextLayout(bytes);
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(20);
  expect(layout.collisions).toEqual([]);
  expect(layout.boxes.filter(box => box.left < 17.5 || box.right > pdf.getPage(box.page - 1).getWidth() - 17.5
    || box.bottom < 17.5 || box.top > pdf.getPage(box.page - 1).getHeight() - 17.5)).toEqual([]);

  const cover = words.filter(word => word.page === 1);
  const body = cover.filter(word => word.top < 730 && word.bottom > 50);
  expect(Math.max(...body.map(word => word.top)) - Math.min(...body.map(word => word.bottom))).toBeLessThanOrEqual(648.1);
  expect(cover.find(word => word.text === 'PCN')!.bottom).toBeGreaterThanOrEqual(36);

  const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict)
    .lookup(PDFName.of('Dests'), PDFDict).lookup(PDFName.of('Names'), PDFArray);
  const destinations = new Map(Array.from({ length: names.size() / 2 }, (_, i) => [
    names.lookup(i * 2, PDFString).decodeText(), names.lookup(i * 2 + 1, PDFArray),
  ]));
  for (const part of input.publication!.sl4!.rows.filter(row => row.kind === 'part')) {
    const id = `sl4.item.${Array.from(part.id).map(char => char.codePointAt(0)!.toString(16)).join('-')}`;
    expect(destinations.has(id), part.id).toBe(true);
  }
  for (let figure = 1; figure <= 5; figure++) expect(destinations.has(`sl4.figure.${figure}`)).toBe(true);
  for (let part = 1; part <= 5; part++) expect(destinations.has(`sl4.part.${part}`)).toBe(true);
  let links = 0;
  for (const page of pdf.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    for (let i = 0; i < annotations.size(); i++) {
      const annotation = annotations.lookup(i);
      if (!(annotation instanceof PDFDict)) continue;
      const action = annotation.lookup(PDFName.of('A'));
      const destination = annotation.lookup(PDFName.of('Dest'))
        ?? (action instanceof PDFDict ? action.lookup(PDFName.of('D')) : undefined);
      if (!(destination instanceof PDFString)) continue;
      expect(destinations.has(destination.decodeText()), destination.decodeText()).toBe(true);
      links++;
    }
  }
  expect(links).toBeGreaterThan(200);

  const widget = pdf.getForm().getField('Signature1').acroField.getWidgets()[0];
  const signaturePage = pdf.getPages().findIndex(page => page.ref.toString() === widget.P()?.toString()) + 1;
  expect(signaturePage).toBeGreaterThan(0);
  const rect = widget.getRectangle();
  expect(words.filter(word => word.page === signaturePage && Math.min(word.right, rect.x + rect.width) - Math.max(word.left, rect.x) > 0.5
    && Math.min(word.top, rect.y + rect.height) - Math.max(word.bottom, rect.y) > 0.5)).toEqual([]);

  const tablePages = [...new Set(words.filter(word => word.text === 'SMR'
    && pdf.getPage(word.page - 1).getWidth() === 792).map(word => word.page))];
  expect(tablePages.length).toBeGreaterThan(1);
  for (const page of tablePages) {
    const { columns, cells } = await pdfTableInsets(bytes, page, words);
    expect(columns).toHaveLength(12);
    // Preface paragraphs 12 and 14 identify the replacement and quantity
    // subcolumns by these labels, including on continued sheets.
    for (const [column, label] of [[6, '(a)'], [7, '(b)'], [9, '(a)'], [10, '(b)']] as const) {
      const cell = cells.find(cell => cell.column === column && cell.text === label);
      expect(cell, `page ${page}, column ${column + 1}`).toBeDefined();
      expect((cell!.left + cell!.right) / 2).toBeCloseTo((columns[column] + columns[column + 1]) / 2, 1);
    }
    for (const [i, width] of SL4_TABLE_GRIDS.partI.entries()) expect(columns[i + 1] - columns[i]).toBeCloseTo(width / 20, 2);
    for (const cell of cells) {
      expect(cell.crossingRules, cell.text).toBe(0);
      expect(cell.leftInset, cell.text).toBeGreaterThanOrEqual(1.99);
      expect(cell.rightInset, cell.text).toBeGreaterThanOrEqual(1.99);
      if (cell.topInset !== null) expect(cell.topInset, cell.text).toBeGreaterThanOrEqual(0.99);
      if (cell.bottomInset !== null) expect(cell.bottomInset, cell.text).toBeGreaterThanOrEqual(0.99);
    }
  }
}, 60000);
