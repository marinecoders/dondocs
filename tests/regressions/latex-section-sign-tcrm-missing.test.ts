/**
 * Regression: a section sign `§` (U+00A7) in any user field made the offline
 * PDF compile abort with no output.
 *
 * Reported failure (e.g. a routine "5 U.S.C. § 552a Privacy Act of 1972"
 * citation):
 *
 *   LaTeX Font Warning: Font shape `TS1/ptm/m/n' undefined,
 *                       using `TS1/cmr/m/n' instead for symbol `textsection'
 *   ! Font TS1/cmr/m/n/12=tcrm1200 at 12.0pt not loadable:
 *                       Metric (TFM) file not found.
 *   ! ==> Fatal error occurred, no output PDF file produced!
 *
 * Root cause: on the modern (2020+, textcomp-integrated) kernel the bundle
 * ships, `§` — and the text shorthands `\S` `\P` `\dag` `\ddag` — route to
 * the TS1 ("text companion") encoding (`\textsection` …). The TS1 Computer
 * Modern metrics (`tcrm*.tfm`) are NOT in the curated 85-file offline font
 * set the SwiftLaTeX engine ships, so pdfTeX can't load `tcrm1200.tfm` and
 * aborts the whole document.
 *
 * Fix: the PDF-path escaper (`escapeLatex` / `processBodyText` in
 * services/latex/escaper.ts) maps `§` → `\ensuremath{\mathsection}` (and the
 * other common non-ASCII symbols → bundled-font LaTeX; math-mode forms for
 * § ¶ † ‡ specifically, since their text shorthands are TS1-routed), with a
 * fail-safe that drops any unmapped non-ASCII symbol so a stray glyph can
 * never fatal the compile. Letters (incl. accented) are preserved. The
 * compile-level proof lives in
 * tests/integration/latex-compile-no-ts1.test.ts (asserts a real compile
 * loads zero `ts1*.fd` / `tcrm` files).
 *
 * This is a unit-level regression because the integration compile matrix uses
 * a full `xelatex` install — which HAS `tcrm1200.tfm` — and therefore cannot
 * reproduce a bundled-font-set gap. We pin the escaper output instead: the
 * generated LaTeX must never route these symbols through `\textsection` (the
 * TS1 path that needs the missing metric).
 */
import { describe, it, expect } from 'vitest';
import { escapeLatex, processBodyText, formatSubjectForLatex } from '@/services/latex/escaper';

describe('section sign / TS1 symbol regression (tcrm1200.tfm not in offline bundle)', () => {
  // FOLLOW-UP (post-merge field report): the first fix mapped § → `\S{}`,
  // assuming `\S` falls back to the cmsy math section sign. WRONG on the
  // modern (2020+, textcomp-integrated) kernel the bundle ships: `\S`
  // expands to `\textsection`, whose DEFAULT encoding is TS1 — the very
  // missing-tcrm crash returned, now via our own output:
  //   l.8 \noindent 1.  5 U.S.C. \S {} 552a Privacy Act of 1972
  //   ! Font TS1/cmr/m/n/12=tcrm1200 ... not loadable
  // The text-mode shorthands \S \P \dag \ddag are therefore BANNED from
  // escaper output. The safe forms are the explicit math-mode symbols
  // (\ensuremath{\mathsection} …), which draw from bundled cmsy and load
  // zero TS1 fonts (verified by A/B compile: \S{} loads ts1ptm.fd; the
  // ensuremath form loads only cmsy10).
  // Regexes, not substrings: `\dag` must not falsely match inside the SAFE
  // math form `\dagger` (nor `\ddag` inside `\ddagger`) — `(?![a-zA-Z])`
  // anchors each banned command at a non-letter boundary.
  const TS1_ROUTED: RegExp[] = [
    /\\textsection/,
    /\\textparagraph/,
    /\\S\{/,
    /\\P\{/,
    /\\dag(?![a-zA-Z])/,
    /\\ddag(?![a-zA-Z])/,
  ];

  it('maps § to \\ensuremath{\\mathsection} (the exact reported citation), never a TS1-routed form', () => {
    const out = escapeLatex('5 U.S.C. § 552a Privacy Act of 1972');
    expect(out).toContain('\\ensuremath{\\mathsection}');
    for (const banned of TS1_ROUTED) {
      expect(out, `must not emit TS1-routed ${banned}`).not.toMatch(banned);
    }
    // The surrounding text must survive intact.
    expect(out).toContain('5 U.S.C.');
    expect(out).toContain('552a Privacy Act of 1972');
  });

  it('handles repeated and body-text § the same way (processBodyText path)', () => {
    const out = processBodyText('See §§ 1 and 2, and ¶ 3.');
    for (const banned of TS1_ROUTED) {
      expect(out, `must not emit TS1-routed ${banned}`).not.toMatch(banned);
    }
    expect((out.match(/\\ensuremath\{\\mathsection\}/g) || []).length).toBe(2);
    expect(out).toContain('\\ensuremath{\\mathparagraph}');
  });

  it('routes § in the subject line through the same safe mapping', () => {
    const out = formatSubjectForLatex('REQUEST UNDER 5 U.S.C. § 552');
    expect(out).toContain('\\ensuremath{\\mathsection}');
    for (const banned of TS1_ROUTED) {
      expect(out, `must not emit TS1-routed ${banned}`).not.toMatch(banned);
    }
  });

  it('maps † and ‡ to math-mode daggers (cmsy), not \\dag/\\ddag (TS1)', () => {
    const out = escapeLatex('footnote† and double‡');
    expect(out).toContain('\\ensuremath{\\dagger}');
    expect(out).toContain('\\ensuremath{\\ddagger}');
    for (const banned of TS1_ROUTED) {
      expect(out, `must not emit TS1-routed ${banned}`).not.toMatch(banned);
    }
  });

  it('maps the other common textcomp/TS1 symbols to bundled-font commands', () => {
    // Each of these would otherwise route to a TS1 symbol needing an un-bundled
    // tc*.tfm metric. Assert none of the TS1 \text* command names appear.
    const out = escapeLatex('Acme© Corp™ Beta® 98.6° ± 0.5° 3×4 6÷2 5µm • · …');
    for (const ts1 of [
      '\\textsection',
      '\\textparagraph',
      '\\textcopyright',
      '\\texttrademark',
      '\\textregistered',
      '\\textdegree',
      '\\textbullet',
    ]) {
      expect(out, `should not emit ${ts1}`).not.toContain(ts1);
    }
    // Spot-check a couple of the safe forms are present.
    expect(out).toContain('\\textcircled{c}'); // ©
    expect(out).toContain('\\ensuremath{^\\circ}'); // °
  });

  it('preserves letters including accented names (composed via inputenc)', () => {
    const out = escapeLatex('From: Col Müller-García, José Ñoño');
    expect(out).toContain('Müller-García');
    expect(out).toContain('José');
    expect(out).toContain('Ñoño');
  });

  it('fail-safe: an unmapped non-ASCII symbol is dropped, not fatal', () => {
    // Emoji / exotic glyphs have no bundled font; dropping them keeps the
    // compile alive instead of aborting the whole document.
    const out = escapeLatex('Status: done 😀 ✅ 🎯 — ship it');
    // No raw non-ASCII symbol survives (would risk a missing-glyph fatal)...
    expect(out).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    // ...but the surrounding ASCII text and the em dash mapping are intact.
    expect(out).toContain('Status: done');
    expect(out).toContain('ship it');
    expect(out).toContain('---'); // em dash → ---
  });

  it('smart quotes / dashes / ellipsis map to classic ASCII-LaTeX forms', () => {
    const out = escapeLatex('He said “hello” to ‘all’ — wait… really–truly');
    expect(out).toContain('``hello\'\'');
    expect(out).toContain('`all\'');
    expect(out).toContain('---'); // em dash
    expect(out).toContain('--');  // en dash
    expect(out).toContain('\\ldots{}');
  });

  it('does not double-escape: the introduced backslashes survive intact', () => {
    // The symbol map runs AFTER the \-escaping phase, so its own backslashes
    // must NOT have been turned into \textbackslash{}.
    const out = escapeLatex('§');
    expect(out).toBe('\\ensuremath{\\mathsection}');
    expect(out).not.toContain('textbackslash');
  });
});
