/**
 * The paragraph-label rule, pinned against SECNAV M-5216.5 Figure 7-8 (p. 7-23).
 *
 * The figure runs the four-mark cycle twice, underlining the counter the second
 * time through:
 *
 *     1.  a.  (1)  (a)     levels 0-3, plain
 *     1.  a.  (1)  (a)     levels 4-7, counter underlined
 *
 * The underline covers the numeral or letter only — periods and parentheses
 * stay plain. That detail is why this table spells out every level rather than
 * asserting "levels 4+ are underlined": the PDF underlined nothing and the DOCX
 * underlined whole labels, punctuation included, and both passed a looser test.
 */
import { describe, it, expect } from 'vitest';
import {
  paragraphMark,
  delimitParagraphMark,
  isUnderlinedLevel,
} from '@/services/latex/paragraphLabel';

/** Figure 7-8, transcribed: level → first two marks, and whether underlined. */
const FIGURE_7_8: Array<{ level: number; marks: [string, string]; underlined: boolean }> = [
  { level: 0, marks: ['1', '2'], underlined: false },
  { level: 1, marks: ['a', 'b'], underlined: false },
  { level: 2, marks: ['1', '2'], underlined: false },
  { level: 3, marks: ['a', 'b'], underlined: false },
  { level: 4, marks: ['1', '2'], underlined: true },
  { level: 5, marks: ['a', 'b'], underlined: true },
  { level: 6, marks: ['1', '2'], underlined: true },
  { level: 7, marks: ['a', 'b'], underlined: true },
];

/** The finished label as it should read, ignoring underlining. */
const EXPECTED_LABELS = [
  '1.', 'a.', '(1)', '(a)',
  '1.', 'a.', '(1)', '(a)',
];

describe('paragraph labels', () => {
  it.each(FIGURE_7_8)('level $level counts $marks', ({ level, marks }) => {
    expect(paragraphMark(level, 1)).toBe(marks[0]);
    expect(paragraphMark(level, 2)).toBe(marks[1]);
  });

  it.each(FIGURE_7_8)('level $level underlined: $underlined', ({ level, underlined }) => {
    expect(isUnderlinedLevel(level)).toBe(underlined);
  });

  it('punctuates each level as the figure does', () => {
    const labels = EXPECTED_LABELS.map((_, level) =>
      delimitParagraphMark(level, paragraphMark(level, 1)),
    );
    expect(labels).toEqual(EXPECTED_LABELS);
  });

  it('puts the delimiter outside the underline, not around it', () => {
    // The distinction the figure makes and the DOCX path used to lose: the
    // period belongs to the label, the underline belongs to the counter.
    const underline = (s: string) => `<u>${s}</u>`;
    expect(delimitParagraphMark(4, underline(paragraphMark(4, 1)))).toBe('<u>1</u>.');
    expect(delimitParagraphMark(6, underline(paragraphMark(6, 1)))).toBe('(<u>1</u>)');
  });

  it('keeps counting in letters past the end of the alphabet', () => {
    // `96 + count` walked out of the alphabet: the 27th sibling was labelled
    // "{" and the 52nd got an unprintable character, so a paragraph could lose
    // its label with nothing on the page to show it.
    expect(paragraphMark(1, 26)).toBe('z');
    expect(paragraphMark(1, 27)).toBe('aa');
    expect(paragraphMark(1, 28)).toBe('ab');
    expect(paragraphMark(1, 52)).toBe('az');
    expect(paragraphMark(1, 53)).toBe('ba');
  });

  it('never emits a mark outside the printable label alphabet', () => {
    for (let count = 1; count <= 200; count++) {
      expect(paragraphMark(1, count), `letters broke at ${count}`).toMatch(/^[a-z]+$/);
      expect(paragraphMark(0, count), `numerals broke at ${count}`).toMatch(/^[0-9]+$/);
    }
  });

  it('keeps deeper nesting visibly deep rather than wrapping to plain', () => {
    // The figure forbids going past level 7, so there is no prescribed answer
    // below it. Staying underlined at least cannot be mistaken for a top-level
    // paragraph, which restarting the cycle would be.
    expect(isUnderlinedLevel(8)).toBe(true);
    expect(isUnderlinedLevel(11)).toBe(true);
  });
});
