// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToFile } from '../../companion/renderToFile';
import { populatedSl3Input } from '../_helpers/populatedSl3';
import { pdfWordBoxes } from '../_helpers/pdfTableInsets';

it.each([
  ['portrait', 'A'], ['portrait', 'D'],
  ['landscape', 'A'], ['landscape', 'D'],
] as const)('keeps the %s Distribution %s cover body within nine inches', async (orientation, statement) => {
  const root = await mkdtemp(join(tmpdir(), 'dondocs-sl3-cover-area-'));
  const input = await populatedSl3Input(orientation);
  input.publication!.distribution = statement === 'A'
    ? { statement }
    : { statement, reason: 'Software Documentation', date: '2026-10-28' };
  const result = await renderToFile(input, {}, root);
  const words = pdfWordBoxes(await readFile(result.path)).filter(w => w.page === 1);
  // Exclude running date/title and PCN, while including the full cover body
  // and mandatory notices. Coordinates are measured from the page bottom.
  const body = words.filter(w => w.top < 730 && w.bottom > 50);
  expect(body.length).toBeGreaterThan(20);
  expect(Math.max(...body.map(w => w.top)) - Math.min(...body.map(w => w.bottom))).toBeLessThanOrEqual(648.1);
  const pcn = words.find(w => w.text === 'PCN')!;
  expect(pcn).toBeDefined();
  expect(pcn.bottom).toBeGreaterThanOrEqual(36);
}, 60000);
