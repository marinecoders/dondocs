// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { wrapRedlineText } from '@/services/pdf/reviewRedlinePdf';
import { drawReviewUnicodeLine } from '@/services/pdf/reviewUnicodeLine';
interface Cluster { text: string; x: number; width: number; start: number; end: number }
interface Fixture { text: string; clusters: Cluster[]; width: number }
const fixture = JSON.parse(await readFile(new URL('../fixtures/review-redline/unicode-line.json', import.meta.url), 'utf8')) as Fixture;
const image = `data:image/png;base64,${(await readFile(new URL('../fixtures/review-redline/unicode-line.png', import.meta.url))).toString('base64')}`;
afterEach(() => vi.unstubAllGlobals());

/** Cached browser geometry and a real embedded synthetic raster isolate reader
 * compatibility from installed fonts. Browser flows verify actual shaping. */
async function extractedLine(prefix: string, rtlFirst: boolean): Promise<{ expected: string; actual: string }> {
  const clusters: Cluster[] = [];let offset = 0, shift = 0;
  for (const char of prefix) { clusters.push({ text: char, start: offset, end: ++offset, x: shift, width: 4 });shift += 4; }
  const ordered = rtlFirst ? [...fixture.clusters.slice(8, 20), fixture.clusters[7], ...fixture.clusters.slice(0, 7), ...fixture.clusters.slice(20)] : fixture.clusters;
  for (const cluster of ordered) {
    const text = cluster.text;
    clusters.push({ ...cluster, text, start: offset, end: offset + text.length, x: cluster.x + shift });offset += text.length;
  }
  const expected = clusters.map(cluster => cluster.text).join('');
  const positions = clusters;
  let currentText = '', base = 0, cursor = 0;
  vi.stubGlobal('document', { body: { appendChild() {} }, createElement: () => ({ style: {}, firstChild: {}, remove() {},
    set textContent(value: string) { currentText = value;base = expected.indexOf(value, cursor);cursor = base + value.length;if (base < 0) throw new Error('Unknown source line'); },
    getBoundingClientRect: () => ({ left: 0, width: fixture.width + shift }) }),
    createRange: () => {
      let start = 0, end = 0;
      return { setStart(_node: unknown, value: number) { start = base + value; }, setEnd(_node: unknown, value: number) { end = base + value; },
        getBoundingClientRect() { const cluster = positions.find(value => value.start === start && value.end === end);if (!cluster) throw new Error(`Unknown cached glyph span in ${currentText}`);return { left: cluster.x, width: cluster.width }; }, getClientRects() { return []; } };
    } });
  const canvas = { toDataURL: () => image } as unknown as HTMLCanvasElement;
  const context = { fillText() {} } as unknown as CanvasRenderingContext2D;
  const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
  for (const [index, text] of wrapRedlineText(expected, 518, text => text.length).entries()) await drawReviewUnicodeLine(pdf, page, text, 47, 700 - index * 20, 10, canvas, context, `ReaderRegression${index}`);
  const task = getDocument({ data: await pdf.save(), useSystemFonts: false }), parsed = await task.promise;
  try {
    const actual = (await (await parsed.getPage(1)).getTextContent({ disableNormalization: true })).items.flatMap(item => 'str' in item ? [item.str, item.hasEOL ? ' ' : ''] : []).join('').trim();
    return { expected: expected.trimEnd(), actual };
  } finally { await task.destroy(); }
}

it.each([
  ['', false],
  ['Long Latin context with many readable letters before this quote. ', false],
  ['', true],
] as const)('independently extracts mixed RTL/LTR words, separators, combining accents and emoji (%s)', async (prefix, rtlFirst) => {
  const { expected, actual } = await extractedLine(prefix, rtlFirst);
  expect(actual).toBe(expected);
  expect(actual).toContain('👩🏽‍🚀');expect(actual).toContain('e\u0301');
});
