/**
 * Via-addressee numbering (SECNAV M-5216.5 Ch 9 ¶2).
 *
 * "If there is only one via addressee remaining, do not number it. If there
 * is more than one remaining, number the remaining addresses starting with
 * the number (1) in parenthesis and consecutively number the rest."
 *
 * The helper is the single source both generators consume, so these cases
 * pin the rule for PDF and DOCX at once.
 */
import { describe, it, expect } from 'vitest';
import { formatViaLines } from '@/lib/viaLines';

describe('formatViaLines', () => {
  it('does not number a lone via addressee', () => {
    expect(formatViaLines('Commander, Naval Air Force, U.S. Atlantic Fleet')).toEqual([
      'Commander, Naval Air Force, U.S. Atlantic Fleet',
    ]);
  });

  it('numbers two or more addressees starting at (1)', () => {
    expect(
      formatViaLines(
        'Commander, Sea Based Anti-Submarine Warfare Wing, Atlantic\nCommander, Naval Air Force, U.S. Atlantic Fleet'
      )
    ).toEqual([
      '(1) Commander, Sea Based Anti-Submarine Warfare Wing, Atlantic',
      '(2) Commander, Naval Air Force, U.S. Atlantic Fleet',
    ]);
  });

  it('skips blank rows so numbering stays consecutive', () => {
    expect(formatViaLines('XO\n\n  \nS-3')).toEqual(['(1) XO', '(2) S-3']);
  });

  // A blank line plus one addressee is still "only one remaining" — the
  // filter must run before the count, or a trailing newline forces numbers.
  it('treats a lone addressee with stray blank lines as unnumbered', () => {
    expect(formatViaLines('XO\n\n')).toEqual(['XO']);
  });

  it('returns an empty list for undefined or all-whitespace input', () => {
    expect(formatViaLines(undefined)).toEqual([]);
    expect(formatViaLines('  \n ')).toEqual([]);
  });
});
