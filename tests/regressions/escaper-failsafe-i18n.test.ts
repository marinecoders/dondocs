/**
 * Regressions in the symbol fail-safe (audit C-1 / C-2).
 *
 * C-1: the fail-safe deleted Unicode separators and numeric glyphs —
 * NBSP (ubiquitous in Word paste) fused words ("ref (a) para 4" →
 * "ref (a)para 4"); "100 m²" became "100 m"; "½ inch" became " inch";
 * "€500" became "500". Separators now map to a plain space and
 * ¹²³½¼¾€ have explicit replacements.
 *
 * C-2: the keep-set was all \p{L}, but non-Latin letters (Greek,
 * Cyrillic, CJK, Hangul, Arabic) make pdfTeX fatal with "Unicode
 * character ... not set up for use with LaTeX" — defeating the
 * fail-safe's purpose. The keep-set is now restricted to the Latin
 * ranges the bundled fonts cover; other scripts are stripped instead
 * of crashing the compile.
 */
import { describe, it, expect } from 'vitest';
import { escapeLatex, processBodyText } from '@/services/latex/escaper';

describe('fail-safe separators and numerics (C-1)', () => {
  it('NBSP becomes a space, not a deletion (no word fusion)', () => {
    const out = escapeLatex('ref (a) para 4');
    expect(out).toBe('ref (a) para 4');
  });

  it('thin/figure/ideographic spaces become spaces', () => {
    expect(escapeLatex('a b c　d')).toBe('a b c d');
  });

  it('superscripts render instead of vanishing', () => {
    const out = escapeLatex('100 m² and x³');
    expect(out).toContain('100 m\\textsuperscript{2}');
    expect(out).toContain('x\\textsuperscript{3}');
  });

  it('vulgar fractions render as text', () => {
    expect(escapeLatex('½ inch and ¾ turn')).toBe('1/2 inch and 3/4 turn');
  });

  it('euro maps to EUR text rather than deletion', () => {
    expect(escapeLatex('€500')).toBe('EUR 500');
  });
});

describe('fail-safe non-Latin scripts (C-2)', () => {
  it('Latin accented names still pass through', () => {
    const out = escapeLatex('Müller-García, José Ñoño, Nguyễn');
    expect(out).toContain('Müller-García');
    expect(out).toContain('Nguyễn'); // Latin Extended Additional (Vietnamese)
  });

  it('Greek/Cyrillic/CJK/Hangul letters are stripped, not passed to pdfTeX', () => {
    // These are \p{L} but the bundled fonts cannot render them — passing
    // them through fatals the compile with "Unicode character not set up".
    const out = escapeLatex('alpha α beta Б kanji 漢 hangul 한 end');
    expect(out).not.toMatch(/[α-ωА-Яа-я一-鿿가-힯]/u);
    expect(out).toContain('alpha');
    expect(out).toContain('end');
  });

  it.each(['👩🏽‍✈️', '✈\uFE0E', '漢\u{E0100}', '1️⃣'])('removes unsupported emoji mark constituents from PDF output: %s', sequence => {
    const source = `Before ${sequence} after`;
    for (const rendered of [escapeLatex(source), processBodyText(source)]) {
      expect(rendered).not.toMatch(/[\p{Variation_Selector}\u200D\u20E3]/u);
      expect(rendered).toContain('Before');
      expect(rendered).toContain('after');
    }
    expect(escapeLatex('Équipe e\u0301')).toBe('Équipe e\u0301');
  });

  it('preserves supported Latin marks, formatting, placeholders and keycap digits', () => {
    expect(processBodyText('**Équipe** e\u0301 {{UNIT}} 1️⃣')).toContain('\\textbf{Équipe} e\u0301');
    expect(processBodyText('**Équipe** e\u0301 {{UNIT}} 1️⃣')).toContain('UNIT');
    expect(escapeLatex('1️⃣')).toBe('1');
  });
});
