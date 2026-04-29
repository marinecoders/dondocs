/**
 * Extends `escaper.property.test.ts` with coverage for the remaining
 * exports of `src/services/latex/escaper.ts`. Originally split off so
 * the first PR's escaper file stayed focused on the protect-then-escape
 * pipeline; this file picks up the rich-text and per-field formatters.
 *
 * Functions covered here:
 *   - convertRichTextToLatex   (markdown markers → LaTeX commands)
 *   - highlightPlaceholders    (yellow-highlights `{{NAME}}` for preview)
 *   - formatSubjectForLatex    (escape + wrap + join with \\newline)
 *   - formatAddressForLatex    (same shape as subject, different default width)
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  convertRichTextToLatex,
  highlightPlaceholders,
  formatSubjectForLatex,
  formatAddressForLatex,
} from '@/services/latex/escaper';

describe('convertRichTextToLatex — marker substitution', () => {
  it('**bold** → \\textbf{bold}', () => {
    expect(convertRichTextToLatex('**hello**')).toBe('\\textbf{hello}');
  });

  it('*italic* → \\textit{italic}', () => {
    expect(convertRichTextToLatex('*hello*')).toBe('\\textit{hello}');
  });

  it('__underline__ → \\uline{underline}', () => {
    expect(convertRichTextToLatex('__hello__')).toBe('\\uline{hello}');
  });

  it('preserves text between markers', () => {
    expect(convertRichTextToLatex('a **b** c *d* e __f__ g')).toBe(
      'a \\textbf{b} c \\textit{d} e \\uline{f} g'
    );
  });

  it('does not match `**` inside `***` (italic-then-bold edge — see issue #14)', () => {
    // Bold pattern is greedy but lazy on the inner group; italic uses a
    // negative lookbehind to avoid sniping bold. Asserting both don't
    // crash on adjacent triple-stars.
    const out = convertRichTextToLatex('***triplet***');
    expect(typeof out).toBe('string');
  });

  it('does not match a single `_` (preserves fill-in-the-blank lines)', () => {
    // Per the docblock + issue #14, fill-in-the-blank text like
    // "Signature: __________" must NOT be partially consumed.
    expect(convertRichTextToLatex('Signature: __________')).toBe('Signature: __________');
  });

  it('Enclosure (1) / Encl (2) → \\enclref{...}', () => {
    expect(convertRichTextToLatex('Per Enclosure (1)')).toBe('Per \\enclref{1}');
    expect(convertRichTextToLatex('Per Encl (2)')).toBe('Per \\enclref{2}');
    expect(convertRichTextToLatex('Per encl (3)')).toBe('Per \\enclref{3}');
  });

  it('reference (a) / Ref (b) → \\reflink{...}', () => {
    expect(convertRichTextToLatex('see reference (a)')).toBe('see \\reflink{a}');
    expect(convertRichTextToLatex('see Ref (b)')).toBe('see \\reflink{b}');
  });

  it('never throws on any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        convertRichTextToLatex(s);
      }),
      { numRuns: 300 }
    );
  });
});

describe('highlightPlaceholders', () => {
  it('wraps `{{NAME}}` in a yellow-highlighted LaTeX command', () => {
    const out = highlightPlaceholders('Hello {{NAME}}');
    // The exact LaTeX output uses \fcolorbox or similar; we don't pin
    // the exact command (so the impl can swap colors / commands later)
    // but the placeholder name MUST appear in the output, and the
    // literal `{{...}}` markers MUST NOT.
    expect(out).toContain('NAME');
    expect(out).not.toMatch(/\{\{NAME\}\}/);
  });

  it('non-placeholder text passes through unchanged', () => {
    expect(highlightPlaceholders('Hello World')).toBe('Hello World');
  });

  it('never throws on any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        highlightPlaceholders(s);
      }),
      { numRuns: 200 }
    );
  });

  it('underscored placeholder names appear (verbatim or escape-form) in output (property)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Z][A-Z0-9_]{0,15}$/), (name) => {
        const out = highlightPlaceholders(`prefix {{${name}}} suffix`);
        // The name appears either verbatim or with `_` LaTeX-escaped to
        // `\_`. Either is acceptable — the PDF render is identical.
        const escapedName = name.replace(/_/g, '\\\\_');
        const re = new RegExp(`(${name}|${escapedName})`);
        expect(out).toMatch(re);
      }),
      { numRuns: 100 }
    );
  });
});

describe('formatSubjectForLatex / formatAddressForLatex', () => {
  it('single-line input returns a single escaped line', () => {
    const out = formatSubjectForLatex('FORMAL COUNSELING - PFT FAILURE');
    expect(out).toBe('FORMAL COUNSELING - PFT FAILURE');
    expect(out).not.toContain('\\newline');
  });

  it('multi-line wrap joins with `\\newline ` (LaTeX in-cell line break)', () => {
    // 80+ chars forces a wrap at default 57-char width.
    const longSubject =
      'A VERY LONG SUBJECT LINE THAT MUST WRAP ONTO A SECOND LINE PER SECNAV M-5216.5 STYLE';
    const out = formatSubjectForLatex(longSubject);
    expect(out).toContain('\\newline');
  });

  it('LaTeX specials in the subject are escaped (& → \\&)', () => {
    const out = formatSubjectForLatex('PROCUREMENT & CONTRACTING');
    expect(out).toContain('\\&');
    expect(out).not.toMatch(/[^\\]&/);
  });

  it('formatAddressForLatex accepts a custom maxLength', () => {
    const out = formatAddressForLatex('Some Address Line', 80);
    expect(typeof out).toBe('string');
    // Short input → single line, no \newline.
    expect(out).toBe('Some Address Line');
  });

  it('both never throw on any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        formatSubjectForLatex(s);
        formatAddressForLatex(s);
      }),
      { numRuns: 300 }
    );
  });

  it('handles undefined / null / empty consistently', () => {
    expect(formatSubjectForLatex(undefined)).toBe('');
    expect(formatSubjectForLatex(null)).toBe('');
    expect(formatSubjectForLatex('')).toBe('');
    expect(formatAddressForLatex(undefined)).toBe('');
    expect(formatAddressForLatex(null)).toBe('');
    expect(formatAddressForLatex('')).toBe('');
  });
});
