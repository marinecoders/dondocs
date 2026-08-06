import { describe, it, expect } from 'vitest';
import { subparagraphIndentIn, ancestorLabelsPerParagraph, labelWidthMilliEm } from '@/services/latex/subparagraphIndent';

const pt = (inches: number) => inches * 72;

describe('subparagraph indent', () => {
  it('is zero at level 0', () => {
    expect(subparagraphIndentIn([], 'times', 12)).toBe(0);
  });

  it('grows with the width of the parent label, not the level number', () => {
    const one = subparagraphIndentIn(['1.'], 'times', 12);
    const ten = subparagraphIndentIn(['10.'], 'times', 12);
    expect(ten).toBeGreaterThan(one);
    // Figure 7-8 prints exactly this: under "10." the subdivision moves right.
    expect(pt(ten - one)).toBeCloseTo(6, 0); // one extra digit at 500/1000 em
  });

  it('tracks the font, because a monospace label is wider', () => {
    expect(subparagraphIndentIn(['1.'], 'courier', 12))
      .toBeGreaterThan(subparagraphIndentIn(['1.'], 'times', 12));
  });

  it('scales with point size', () => {
    expect(subparagraphIndentIn(['1.'], 'courier', 12))
      .toBeCloseTo(subparagraphIndentIn(['1.'], 'courier', 10) * 1.2, 6);
  });

  it('accumulates every ancestor', () => {
    const deep = subparagraphIndentIn(['1.', 'a.', '(1)'], 'times', 12);
    const shallow = subparagraphIndentIn(['1.', 'a.'], 'times', 12);
    expect(deep).toBeGreaterThan(shallow);
  });

  it('Courier is monospaced so every glyph counts the same', () => {
    expect(labelWidthMilliEm('(1)', 'courier')).toBe(1800);
    expect(labelWidthMilliEm('1.', 'courier')).toBe(1200);
  });

  it('survives a document that opens at a subparagraph', () => {
    // fast-check found this: a level-1 paragraph with no level-0 above it
    // leaves a hole in the ancestor chain, which used to be measured as a
    // label and threw.
    expect(ancestorLabelsPerParagraph(['a.'], [1])).toEqual([[]]);
    expect(subparagraphIndentIn([], 'times', 12)).toBe(0);
  });

  it('picks up the ancestor actually used, not a nominal one', () => {
    const labels = ['9.', '10.', 'a.', '(1)'];
    const levels = [0, 0, 1, 2];
    expect(ancestorLabelsPerParagraph(labels, levels)).toEqual([
      [], [], ['10.'], ['10.', 'a.'],
    ]);
  });
});
