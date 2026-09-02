/**
 * The Word address label column has to hold the widest of "From:", "To:",
 * "Via:" and "Subj:" once their padding spaces are counted.
 *
 * The PDF column is `l`, so it always does. Word's is fixed, and it was fixed
 * at 0.50in for every font: about a point of slack in Times at 12pt, and far
 * too narrow for Courier, whose "To:" plus six spaces runs 0.90in. A label that
 * does not fit wraps inside its own cell, which is what the From/To/Subj block
 * looked like in Word.
 */
import { describe, it, expect } from 'vitest';
import { addressLabelFraction, TEXT_WIDTH_IN } from '@/services/docx/layout-config';

const inches = (family: string, size: number) => addressLabelFraction(family, size) * TEXT_WIDTH_IN;

// Courier New is monospaced at 0.6em, so a label's width is exactly
// (glyphs + padding spaces) x 0.6 x size. "To:" carries six spaces.
const courierWidest = (size: number) => (3 + 6) * 0.6 * size / 72;

describe('address label column', () => {
  it('holds Courier, whose widest label is nearly twice the old column', () => {
    for (const size of [10, 11, 12]) {
      expect(inches('courier', size)).toBeGreaterThan(courierWidest(size));
    }
  });

  it('holds Times at every offered size', () => {
    // "From:" is the widest: 2.5em of glyphs plus two 0.25em spaces, so 3.0em
    // exactly. At 12pt that is 36pt — the whole half inch the column used to
    // be, which is why it was the From line that broke.
    const timesWidest = (size: number) => (3.0 * size) / 72;
    for (const size of [10, 11, 12]) {
      expect(inches('times', size)).toBeGreaterThan(timesWidest(size));
    }
  });

  it('grows with the font size rather than staying at one inch value', () => {
    expect(inches('times', 12)).toBeGreaterThan(inches('times', 10));
    expect(inches('courier', 12)).toBeGreaterThan(inches('courier', 10));
  });

  it('does not eat the content column', () => {
    // Even Courier at 12pt — the worst case — leaves most of the line for text.
    expect(addressLabelFraction('courier', 12)).toBeLessThan(0.2);
  });

  it('falls back to Times for an unknown face, and for none', () => {
    expect(addressLabelFraction('helvetica', 12)).toBe(addressLabelFraction('times', 12));
    expect(addressLabelFraction(undefined, undefined)).toBe(addressLabelFraction('times', 12));
  });
});

describe('one source of truth', () => {
  it('the stored proportion is the formula at its defaults', async () => {
    // Two numbers for the same column drift. The metadata path and the stored
    // LAYOUT must agree for a caller that has no font to hand.
    const { LAYOUT } = await import('@/services/docx/layout-config');
    expect(LAYOUT.address.labelCol).toBe(addressLabelFraction());
    expect(LAYOUT.address.contentCol).toBe(1 - addressLabelFraction());
  });
});
