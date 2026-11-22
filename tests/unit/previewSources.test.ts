import { describe, expect, it } from 'vitest';
import { previewPageText, sourcesAcrossPages, sourcesOnPage, type PreviewSource } from '@/lib/previewSources';
const source: PreviewSource = { id: 'p1', label: 'Paragraph 1', sectionId: 'body', text: 'A unique paragraph to navigate.' };
describe('preview source anchors', () => {
  it('does not attribute a longer paragraph to a shorter paragraph embedded in it', () => {
    const longer = { ...source, id: 'p2', text: source.text + ' Additional instructions follow.' };
    expect(sourcesOnPage(longer.text, [source, longer])).toEqual([longer]);
    expect(sourcesOnPage(longer.text, [source, longer, { ...longer, id: 'p3' }])).toEqual([]);
  });
  it('does not match partial words or identifiers', () => {
    const field = { ...source, text: 'Personnel request' };
    expect(sourcesOnPage('Personnel requests', [field])).toEqual([]);
    expect(sourcesOnPage('xPersonnel request', [field])).toEqual([]);
  });
  it('matches wrapped PDF text without altering punctuation', () => {
    expect(sourcesOnPage('1. A UNIQUE paragraph\n to navigate.', [source])).toEqual([source]);
    expect(sourcesOnPage('A unique paragraph to navigate!', [source])).toEqual([]);
  });
  it('rejects ambiguous, short, empty and absent text', () => {
    expect(sourcesOnPage(source.text, [source, { ...source, id: 'p2' }])).toEqual([]);
    expect(sourcesOnPage('Hello', [{ ...source, text: 'Hello' }])).toEqual([]);
    expect(sourcesOnPage(source.text, [{ ...source, text: '' }])).toEqual([]);
    expect(sourcesOnPage('another page', [source])).toEqual([]);
    expect(sourcesOnPage('', [source])).toEqual([]);
  });
});

describe('cross-page source matches', () => {
  const first = 'This unique first fragment contains several deliberate training instructions';
  const second = 'and this distinctive continuation finishes the same complete paragraph.';
  const paragraph = { ...source, paragraphId: 'p1', text: `${first} ${second}` };
  it('associates both adjacent pages only after the complete source is measured', () => {
    expect(sourcesAcrossPages({ 0: first }, [paragraph]).get(0)).toEqual([]);
    const matches = sourcesAcrossPages({ 0: `1. ${first}`, 1: `Subj: TRAINING SUBJECT ${second}` }, [paragraph], 'TRAINING SUBJECT');
    expect(matches.get(0)).toEqual([paragraph]);
    expect(matches.get(1)).toEqual([paragraph]);
  });
  it('supports complete paragraphs continued over multiple pages', () => {
    const third = 'while the final measured page completes all the remaining detailed instructions.';
    const extended = { ...paragraph, text: `${first} ${second} ${third}` };
    const matches = sourcesAcrossPages({ 0: first, 1: second, 2: third }, [extended]);
    for (const index of [0, 1, 2]) expect(matches.get(index)).toEqual([extended]);
  });
  it('does not attribute a spanning quotation to its shorter source paragraph', () => {
    const quoted = { ...paragraph, id: 'quoted', paragraphId: 'quoted', text: second };
    const matches = sourcesAcrossPages({ 0: first, 1: second }, [paragraph, quoted]);
    expect(matches.get(1)).toEqual([paragraph]);
  });
  it('withholds missing, modified, repeated and unrelated fragments', () => {
    expect(sourcesAcrossPages({ 0: first, 2: second }, [paragraph]).get(0)).toEqual([]);
    expect(sourcesAcrossPages({ 0: first, 1: second.replace('same', 'other') }, [paragraph]).get(0)).toEqual([]);
    expect(sourcesAcrossPages({ 0: first, 1: second }, [paragraph, { ...paragraph, id: 'p2' }]).get(0)).toEqual([]);
    expect(sourcesAcrossPages({ 0: first + ' unrelated body text', 1: second }, [paragraph]).get(0)).toEqual([]);
    expect(sourcesAcrossPages({ 0: first, 1: 'Unknown running header ' + second }, [paragraph]).get(0)).toEqual([]);
    expect(sourcesAcrossPages({ 0: first, 1: second, 2: first, 3: second }, [paragraph]).get(0)).toEqual([]);
  });
});

it('orders late-painted letterhead and split lines by their PDF positions', () => {
  const item = (str: string, x: number, y: number) => ({ str, transform: [12, 0, 0, 12, x, y] });
  expect(previewPageText([item('body', 70, 500), item('right', 150, 700), item('left', 70, 700), { type: 'markedContent' }])).toBe('left right body');
});

it('removes only positioned numeric footers, preserving body numbers and unknown markings', () => {
  const item = (str: string, y: number) => ({ str, transform: [12, 0, 0, 12, 70, y] });
  expect(previewPageText([item('Body', 700), item('99', 70), item('2', 36)])).toBe('Body 99');
  expect(previewPageText([item('2 of 8', 53.9)])).toBe('');
  expect(previewPageText([item('54', 54)])).toBe('54');
  expect(previewPageText([item('CUI', 36), item('99', -1)])).toBe('CUI 99');
});

it('orders many text rows and withholds rotated or invalid coordinates', () => {
  const items = Array.from({ length: 400 }, (_, index) => ({ str: `line${index}`, transform: [12, 0, 0, 12, 70, 5000 - index * 12] }));
  const rotated = { str: 'rotated', transform: [0, 12, -12, 0, 70, 7000] };
  const invalid = { str: 'invalid', transform: [12, 0, 0, 12, Number.NaN, 6000] };
  expect(previewPageText([...items].reverse().concat([rotated, invalid]))).toBe(items.map(item => item.str).join(' '));
});
