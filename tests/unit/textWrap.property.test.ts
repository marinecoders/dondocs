/**
 * Property-based tests for `wrapTextForForm`.
 *
 * Where the canonical-cases file pins down "for THIS input we expect THESE
 * lines", this file specifies invariants that must hold for ANY input. The
 * fast-check runner generates random inputs (including pathological ones)
 * and tries to break the property; failures are auto-shrunk to the smallest
 * reproducer and the seed is reported so the failure can be replayed.
 *
 * The properties below are the ones we'd notice as "broken" without ever
 * looking at a PDF — crashes, dropped content, infinite loops, etc. They
 * complement (don't replace) the eyeballed cases file and the visual-diff
 * pipeline that lives downstream of the generator.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { wrapTextForForm } from '@/services/pdf/textWrap';
import { monoFont } from '../_helpers/monoFont';

// Custom arbitrary that biases toward the kinds of strings actual users
// type into NAVMC fields: SECNAV labels, leading whitespace, mixed
// punctuation, occasional newlines. Pure `fc.string()` is mostly noise
// and reaches the interesting edges only by accident.
const labelArb = fc.constantFrom(
  '1.',
  '2.',
  '23.',
  'a.',
  'b.',
  'Z.',
  '(1)',
  '(2)',
  '(a)',
  '(z)',
  ''
);
const leadingWsArb = fc.constantFrom('', ' ', '  ', '   ', '    ', '\t', '\t\t');
const wordArb = fc
  .stringMatching(/^[A-Za-z0-9.,;:!?'"-]+$/)
  .filter((s) => s.length > 0 && s.length < 30);
const paragraphArb = fc
  .tuple(leadingWsArb, labelArb, fc.array(wordArb, { minLength: 0, maxLength: 12 }))
  .map(([ws, label, words]) => {
    const labelPart = label ? `${label} ` : '';
    return `${ws}${labelPart}${words.join(' ')}`;
  });
const realisticTextArb = fc
  .array(paragraphArb, { minLength: 0, maxLength: 8 })
  .map((paras) => paras.join('\n'));

describe('wrapTextForForm — properties', () => {
  it('never throws on realistic SECNAV-shaped input', () => {
    fc.assert(
      fc.property(realisticTextArb, fc.integer({ min: 8, max: 120 }), (text, maxWidth) => {
        wrapTextForForm(text, maxWidth, monoFont, 1);
      }),
      { numRuns: 500 }
    );
  });

  it('never throws on arbitrary string input', () => {
    // Wider net than the realistic arbitrary — surrogate halves, control
    // chars, embedded nulls, very long runs, etc. Catches "the algorithm
    // assumed clean ASCII" bugs.
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 200 }), (text, maxWidth) => {
        wrapTextForForm(text, maxWidth, monoFont, 1);
      }),
      { numRuns: 500 }
    );
  });

  it('returns at least one line for any non-trivial input', () => {
    // Empty / whitespace-only inputs survive as a single empty line, which
    // is the contract `drawMultilineText` relies on. If the helper ever
    // returns [], the field would silently render as "" and any calling
    // bookkeeping (line count, max-line caps, page overflow) misbehaves.
    fc.assert(
      fc.property(realisticTextArb.filter((s) => s.length > 0), (text) => {
        const lines = wrapTextForForm(text, 80, monoFont, 1);
        expect(lines.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 200 }
    );
  });

  it('preserves words: every word in the input also appears in the output (modulo whitespace collapse)', () => {
    // The wrap helper rearranges whitespace and may re-flow lines, but it
    // must never DROP a non-empty word. This is the property that would
    // have caught the original #24 bug — when the old `wrapText` did
    // `currentLine = word` on wrap, it dropped the SECNAV label prefix
    // (the label is a "word" in our extraction sense and would not appear
    // in the wrapped output).
    fc.assert(
      fc.property(realisticTextArb, fc.integer({ min: 12, max: 80 }), (text, maxWidth) => {
        const lines = wrapTextForForm(text, maxWidth, monoFont, 1);
        // Tabs are normalized to 4 spaces, so do the same to the input
        // before extracting words.
        const inputWords = text.replace(/\t/g, '    ').split(/\s+/).filter((w) => w.length > 0);
        const outputWords = lines.join(' ').split(/\s+/).filter((w) => w.length > 0);
        // Multiset equality (every word, including duplicates).
        expect(outputWords.sort()).toEqual(inputWords.sort());
      }),
      { numRuns: 300 }
    );
  });

  it('paragraph count is preserved (newlines map to line boundaries)', () => {
    // The number of paragraphs in the input (split on \n) must be ≤ the
    // number of output lines: empty paragraphs survive as one blank line
    // each, and non-empty paragraphs produce at least one line. If a
    // paragraph silently disappears, the form would be missing data.
    fc.assert(
      fc.property(realisticTextArb, (text) => {
        const inputParagraphCount = text.split('\n').length;
        const lines = wrapTextForForm(text, 60, monoFont, 1);
        expect(lines.length).toBeGreaterThanOrEqual(inputParagraphCount);
      }),
      { numRuns: 200 }
    );
  });

  it('terminates within a bounded number of lines per paragraph', () => {
    // No input should produce an unbounded number of output lines. This
    // is a guard against an infinite-wrap bug (e.g. if the algorithm ever
    // failed to advance through the word list and wrapped the same word
    // forever, this would catch it before the test timeout fires).
    fc.assert(
      fc.property(realisticTextArb, (text) => {
        const lines = wrapTextForForm(text, 20, monoFont, 1);
        // Worst case: every character is its own line, plus paragraph
        // boundaries. This bound is generous; a real bug would blow it
        // out by orders of magnitude.
        expect(lines.length).toBeLessThan(text.length + 100);
      }),
      { numRuns: 200 }
    );
  });
});
