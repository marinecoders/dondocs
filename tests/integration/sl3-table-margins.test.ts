// @vitest-environment node
import { it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { renderToFile } from '../../companion/renderToFile';
import { populatedSl3Input } from '../_helpers/populatedSl3';
import { pdfTableInsets, pdfWordBoxes } from '../_helpers/pdfTableInsets';
import { pdfTextLayout } from '../_helpers/pdfTextLayout';
import { SL3_INVENTORY_RULE_WIDTH, sl3InventoryGeometry } from '@/data/techpub/sl3';

it.each([
  ['portrait', false], ['landscape', false], ['portrait', true], ['landscape', true],
] as const)('preserves the %s source grid and leaves space inside populated cells, compact values=%s', async (orientation, compact) => {
  const root = await mkdtemp(join(tmpdir(), 'dondocs-sl3-cell-margins-'));
  const input = await populatedSl3Input(orientation);
  if (compact) Object.assign(input.publication!.sl3!.components[10], { unit: 'MM', quantity: '10000' });
  const rendered = await renderToFile(input, {}, root);
  const bytes = await readFile(rendered.path);
  const pdf = await PDFDocument.load(bytes);
  const layout = await pdfTextLayout(bytes);
  const words = pdfWordBoxes(bytes);
  expect(layout.collisions).toEqual([]);
  const geometry = sl3InventoryGeometry(input.publication!.sl3!);
  let tables = 0;
  for (let page = 1; page <= pdf.getPageCount(); page++) {
    const { columns, cells } = await pdfTableInsets(bytes, page, words);
    if (columns.length < 19) continue;
    tables++;
    expect(columns).toHaveLength(geometry.widths.length + 1);
    for (const [i, width] of geometry.widths.entries()) {
      expect(columns[i + 1] - columns[i], `page ${page}, source column ${i + 1}`).toBeCloseTo(width, 2);
    }
    expect(columns[0] - SL3_INVENTORY_RULE_WIDTH / 2).toBeGreaterThanOrEqual(17.99);
    expect(columns.at(-1)! + SL3_INVENTORY_RULE_WIDTH / 2).toBeLessThanOrEqual(pdf.getPage(page - 1).getWidth() - 17.99);
    expect(cells.length).toBeGreaterThan(20);
    for (const cell of cells) {
      expect(cell.crossingRules, cell.text).toBe(0);
      const compactCell = compact && (cell.text === 'MM' || cell.text === '10000');
      expect(cell.leftInset, cell.text).toBeGreaterThanOrEqual(compactCell ? 0.49 : cell.column === 1 ? 0.69 : cell.column === 2 ? 3.59 : 1.99);
      expect(cell.rightInset, cell.text).toBeGreaterThanOrEqual(compactCell ? 0.49 : cell.column === 1 ? 0.69 : 1.99);
      if (cell.topInset !== null) expect(cell.topInset, cell.text).toBeGreaterThanOrEqual(1.99);
      if (cell.bottomInset !== null) expect(cell.bottomInset, cell.text).toBeGreaterThanOrEqual(1.99);
    }
  }
  expect(tables).toBe(5);
  if (compact) for (const value of ['MM', '10000']) expect(words.some((b) => b.text === value)).toBe(true);
}, 60000);

it.each([
  ['unit', 'UNRENDERABLE', 'Unit of measure exceeds its column'],
  ['quantity', '123456789', 'Quantity exceeds its column'],
  ['partNumber', 'WWWWWWWWWWWWWW', 'An inventory identifier exceeds its column'],
] as const)('refuses an oversized %s instead of printing into the cell margin', async (field, value, error) => {
  const root = await mkdtemp(join(tmpdir(), 'dondocs-sl3-cell-overflow-'));
  const input = await populatedSl3Input('portrait');
  input.publication!.sl3!.components[0][field] = value;
  await expect(renderToFile(input, {}, root)).rejects.toThrow(error);
}, 60000);
