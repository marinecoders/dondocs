import { describe, it, expect } from 'vitest';
import { itemsToLines, type PositionedItem } from '@/lib/pdfText';

// pdf.js hands back positioned fragments; itemsToLines regroups them into
// lines. Model fragments as {str, x, y, height}; PDF Y grows upward, so a
// higher y is a higher line on the page.
const item = (str: string, x: number, y: number, height = 10): PositionedItem => ({
  str,
  x,
  y,
  height,
});

describe('itemsToLines', () => {
  it('groups fragments on the same baseline into one left-to-right line', () => {
    // Deliberately out of reading order to prove the sort.
    const items = [item('world', 60, 700), item('Hello ', 10, 700)];
    expect(itemsToLines(items)).toEqual(['Hello world']);
  });

  it('orders lines top-to-bottom by descending y', () => {
    const items = [item('second', 10, 680), item('first', 10, 700)];
    expect(itemsToLines(items)).toEqual(['first', 'second']);
  });

  it('keeps two nearby baselines as separate lines', () => {
    // 14pt apart with 10pt text: beyond the 0.5×height tolerance → two lines.
    const items = [item('From:', 10, 700), item('To:', 10, 686)];
    expect(itemsToLines(items)).toEqual(['From:', 'To:']);
  });

  it('absorbs sub-baseline jitter within the tolerance into one line', () => {
    // A superscript-ish fragment 3pt up on a 10pt line stays on the line.
    const items = [item('MOS', 10, 700), item('(0311)', 40, 703)];
    expect(itemsToLines(items)).toEqual(['MOS(0311)']);
  });

  it('returns an empty array for no items', () => {
    expect(itemsToLines([])).toEqual([]);
  });
});
