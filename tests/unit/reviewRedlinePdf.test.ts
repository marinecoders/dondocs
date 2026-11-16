// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { detectTextPII } from '@/services/pii/detector';
import { generateReviewRedlinePdf, inlineRedlineRuns, layoutRedline, redlineBlocks, wrapRedlineText, type RedlineContent } from '@/services/pdf/reviewRedlinePdf';
import { reviewTextDirection, assertRedlineGlyphs } from '@/services/pdf/reviewUnicodeLine';

export function redlineFixture(): RedlineContent {
  return { roundLabel: 'Synthetic PDF review', capturedAt: '2026-11-15T12:00:00.000Z', roundStatus: 'active', baselineDigest: 'a'.repeat(64), currentDigest: 'b'.repeat(64),
    counts: { accepted: 1, rejected: 0, open: 0, conflicting: 0 }, marking: 'UNCLASSIFIED', customMarkings: [], notices: [], privacy: detectTextPII([]),
    items: [{ label: 'Recipient replacement', author: 'Synthetic reviewer', category: 'Edit', status: 'accepted', acceptedCurrentChanged: false, origin: { kind: 'manual' },
      changes: [{ label: 'To', kind: 'field', baseline: 'Original recipient', current: 'Captured recipient', proposed: 'Proposed recipient', accepted: 'Accepted recipient' }],
      history: [{ action: 'accepted', at: '2026-11-15T12:00:00.000Z', resolutions: [{ before: 'Manual current', accepted: 'Manual accepted' }] }] }],
    discussions: [{ version: 'Captured current draft', target: 'Paragraph 1', category: 'Question', status: 'Open - Target changed', context: 'Retained quote', current: 'Newer quote',
      messages: [{ author: 'Synthetic commenter', text: 'RETAINED_COMMENT_END', createdAt: '2026-11-15T12:00:00.000Z' }] }], comparison: [{ field: 'Paragraph 1 movement', before: 'Position 1', after: 'Position 2', kind: 'move' }] };
}
function canvasDocument() {
  const context = { font: '', clearRect() {}, fillText() {}, measureText: (text: string) => ({ width: text.length * 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }) };
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve() }, createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
}
afterEach(() => vi.unstubAllGlobals());

it('wraps complete graphemes and preserves all whitespace and long tokens', () => {
  const source = '  A👩🏽‍🚀e\u0301 長 token  ';
  const lines = wrapRedlineText(source, 3, text => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length);
  expect(lines.join('')).toBe(source);expect(lines.some(line => line.includes('👩🏽‍🚀'))).toBe(true);
  expect(() => wrapRedlineText('x', 1, () => 2)).toThrow('too wide');
  expect(wrapRedlineText('one\n\ntwo\n', 9, text => text.length)).toEqual(['one', '', 'two', '']);
});

it('keeps every line within page bounds through long replacements and rejects excessive output', () => {
  const pages = layoutRedline([{ text: 'LongToken'.repeat(2000), role: 'text' }], text => text.length * 5);
  expect(pages.length).toBeGreaterThan(3);
  for (const lines of pages) for (const line of lines) { expect(line.x + line.width).toBeLessThanOrEqual(570);expect(line.y).toBeGreaterThan(58);expect(line.y).toBeLessThanOrEqual(734); }
  expect(() => layoutRedline([{ text: 'x\n'.repeat(12000), role: 'text' }], text => text.length)).toThrow('250 pages');
  const data = redlineFixture();data.roundLabel = 'x'.repeat(2_000_001);expect(() => redlineBlocks(data)).toThrow('character review limit');
});

it('labels moves separately from replacement text and retains every decision/discussion version', () => {
  const data = redlineFixture();data.items[0].changes[0].kind = 'move-paragraph';data.items[0].changes[0].label = 'Move source before destination with children';
  const text = redlineBlocks(data).map(block => block.text).join('\n');
  for (const value of ['REVIEW COPY', 'Clean PDF output is separate', '[>] MOVE - Move source', 'not deleted/reinserted identities', 'Original recipient', 'Captured recipient', 'Proposed recipient', 'Accepted recipient', 'Manual current', 'Manual accepted', 'RETAINED_COMMENT_END']) expect(text).toContain(value);
});

it('generates real multipage PDF bytes with searchable versions, page counts and bounded geometry', async () => {
  canvasDocument();const data = redlineFixture();data.items[0].changes[0].proposed = `${'LongToken'.repeat(2000)} PROPOSED_END`;
  const bytes = await generateReviewRedlinePdf(data);expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  const decoded = await PDFDocument.load(bytes);expect(decoded.getPageCount()).toBeGreaterThan(3);
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });const pdf = await task.promise;const all: string[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), content = await page.getTextContent();
      const text = content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ');all.push(text);
      expect(text).toContain(`Page ${i} of ${pdf.numPages}`);
      for (const item of content.items) if ('str' in item && item.str.trim()) { expect(item.transform[4]).toBeGreaterThanOrEqual(41);expect(item.transform[4] + item.width, item.str).toBeLessThanOrEqual(571);expect(item.transform[5]).toBeGreaterThanOrEqual(29);expect(item.transform[5]).toBeLessThanOrEqual(767); }
    }
  } finally { await task.destroy(); }
  for (const text of ['Original recipient', 'Captured recipient', 'PROPOSED_END', 'Accepted recipient', 'RETAINED_COMMENT_END', 'UNCLASSIFIED', '[-] DELETE', '[+] INSERT']) expect(all.join('\n')).toContain(text);
});

it('cancels generation, fails when canvas is unavailable and detects unsupported glyphs', async () => {
  canvasDocument();await expect(generateReviewRedlinePdf(redlineFixture(), () => true)).rejects.toThrow('cancelled');
  let cancelled = false;setTimeout(() => { cancelled = true; }, 0);
  await expect(generateReviewRedlinePdf(redlineFixture(), () => cancelled)).rejects.toThrow('cancelled');
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve() }, createElement: () => ({ getContext: () => null }) });
  await expect(generateReviewRedlinePdf(redlineFixture())).rejects.toThrow('canvas support');
  const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
  const context = { clearRect() {}, fillText() {}, measureText: () => ({ width: 12 }), getImageData: () => ({ data: new Uint8ClampedArray([1]) }) } as unknown as CanvasRenderingContext2D;
  await expect(assertRedlineGlyphs('漢', canvas, context)).rejects.toThrow('U+6F22');
  expect(reviewTextDirection('Café العربية')).toBe('ltr');expect(reviewTextDirection('العربية Café')).toBe('rtl');
});

it('retains exact old/new text with whole-grapheme strike and underline runs across page wraps', () => {
  for (const [before, after] of [['Keep old words and suffix.', 'Keep new words and suffix.'], ['e\u0301', 'e\u0308'], ['e', 'e\u0301'], ['', '👩🏽‍🚀'], ['Old body', '']]) {
    const runs = inlineRedlineRuns(before, after);
    expect(runs.filter(run => run.style !== 'insert').map(run => run.text).join('')).toBe(before);
    expect(runs.filter(run => run.style !== 'delete').map(run => run.text).join('')).toBe(after);
  }
  const runs = [{ text: 'DELETE'.repeat(400), style: 'delete' as const }, { text: 'INSERT'.repeat(400), style: 'insert' as const }];
  const pages = layoutRedline([{ text: runs.map(run => run.text).join(''), runs, role: 'text' }], text => text.length * 10);
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.flat().flatMap(line => line.marks).some(mark => mark.style === 'delete')).toBe(true);
  expect(pages.flat().flatMap(line => line.marks).some(mark => mark.style === 'insert')).toBe(true);
  for (const line of pages.flat()) for (const mark of line.marks) { expect(mark.start).toBeGreaterThanOrEqual(0);expect(mark.end).toBeLessThanOrEqual(line.text.length); }
});

it('renders range context and structural boundaries as actual annotated text, leaving moves unstruck', () => {
  const data = redlineFixture(), change = data.items[0].changes[0];
  change.kind = 'range';change.baseline = 'old';change.proposed = 'new';change.context = 'Prefix old suffix';change.range = { start: 7, end: 10 };
  const block = redlineBlocks(data).find(block => block.runs)!;
  expect(block.text).toBe('Prefix oldnew suffix');expect(block.runs).toEqual([{ text: 'Prefix ' }, { text: 'old', style: 'delete' }, { text: 'new', style: 'insert' }, { text: ' suffix' }]);
  change.kind = 'split-paragraph';change.baseline = 'A body';change.proposed = 'A\n\n body';delete change.context;delete change.range;
  expect(redlineBlocks(data).find(block => block.runs)!.text).toContain('[PARAGRAPH BREAK]');
  change.kind = 'move-paragraph';expect(redlineBlocks(data).some(block => block.runs)).toBe(false);
});

it('wraps every writing-direction boundary without losing LTR-first source separators', () => {
  const source = 'Café 中文 العربية שלום 👩🏽‍🚀 e\u0301';
  const lines = wrapRedlineText(source, 518, text => text.length);
  expect(lines).toEqual(['Café 中文 ', 'العربية שלום ', '👩🏽‍🚀 e\u0301']);
  expect(lines.join('')).toBe(source);
});

it.each(['split-paragraph', 'join-paragraphs'])('labels one %s boundary once and preserves captured values', kind => {
  const data = redlineFixture(), change = data.items[0].changes[0];
  change.kind = kind;
  change.baseline = kind === 'split-paragraph' ? 'First second' : 'First\n\nsecond';
  change.proposed = kind === 'split-paragraph' ? 'First\n\nsecond' : 'First second';
  change.current = change.baseline;
  const original = structuredClone(data);
  const blocks = redlineBlocks(data), inline = blocks.find(block => block.runs)!;
  expect(inline.text.match(/\[PARAGRAPH BREAK\]/g)).toHaveLength(1);
  for (const value of [change.baseline, change.current, change.proposed]) expect(blocks.some(block => !block.runs && block.text === value)).toBe(true);
  expect(data).toEqual(original);
});

it('lets a queued cancellation stop glyph preflight before scanning a large supported alphabet', async () => {
  const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
  let drawn = '', cancelled = false;
  const readback = vi.fn(() => ({ data: new Uint8ClampedArray([drawn.codePointAt(0)! % 255]) }));
  const context = { clearRect() {}, fillText(value: string) { drawn = value; },
    measureText: () => ({ width: drawn.codePointAt(0)! }), getImageData: readback } as unknown as CanvasRenderingContext2D;
  // A deterministic clock makes a batch take time without burning CPU in CI.
  let elapsed = 0;const now = vi.spyOn(performance, 'now').mockImplementation(() => ++elapsed * 9);
  const text = Array.from({ length: 20_000 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
  const timer = setTimeout(() => { cancelled = true; }, 0);
  try {
    await expect(Promise.resolve(assertRedlineGlyphs(text, canvas, context, () => cancelled))).rejects.toThrow('cancelled');
    expect(cancelled).toBe(true);expect(readback.mock.calls.length).toBeLessThan(1000);
  } finally { clearTimeout(timer);now.mockRestore(); }
});

it('rejects page overflow before any glyph fingerprint readback', async () => {
  let drawn = '';
  const readback = vi.fn(() => ({ data: new Uint8ClampedArray([drawn.codePointAt(0)! % 255]) }));
  const context = { font: '', clearRect() {}, fillText(value: string) { drawn = value; }, measureText: (text: string) => ({ width: text.length * 10 }), getImageData: readback };
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve() }, createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  const data = redlineFixture();data.roundLabel = '漢\n'.repeat(12_000);
  await expect(generateReviewRedlinePdf(data)).rejects.toThrow('250 pages');
  expect(readback).not.toHaveBeenCalled();
});
