/**
 * Regression for #24 — NAVMC forms didn't preserve SECNAV hanging indent
 * on wrapped sub-paragraphs.
 *
 * Issue: https://github.com/marinecoders/dondocs/issues/24
 * Fix:   PR #65 (commit 4285b72) — extracted the duplicated `wrapText`
 *        helpers in navmc10274Generator.ts and navmc11811Generator.ts
 *        into a shared `wrapTextForForm` that detects optional SECNAV
 *        labels (`1.`, `a.`, `(1)`, `(a)`) and prepends a hang prefix
 *        so continuation lines align with where the paragraph TEXT
 *        starts (per SECNAV M-5216.5 Ch 7 ¶13 and MCO 1070.12K).
 *
 * Pre-fix failure mode: a sub-paragraph the user typed as
 *
 *     a. Sub-paragraph long enough to wrap onto another line.
 *
 * rendered as
 *
 *     a. Sub-paragraph long enough to
 *   wrap onto another line.            ← continuation at column 0 (WRONG)
 *
 * because the inline `wrapText` did `currentLine = word` on wrap,
 * dropping the leading whitespace and the label prefix on every
 * continuation line.
 *
 * The canonical form per Ch 7 ¶13 ("do not indent the continuation
 * lines of a subparagraph") is:
 *
 *     a. Sub-paragraph long enough to
 *        wrap onto another line.       ← hangs after the label (CORRECT)
 */
import { describe, it, expect } from 'vitest';
import { wrapTextForForm } from '@/services/pdf/textWrap';
import { monoFont } from '../_helpers/monoFont';

describe('regression #24 — SECNAV hanging indent on wrapped sub-paragraphs', () => {
  it('level-2 label "  a." continuation hangs after the label, not at col 0', () => {
    const input = '  a. Second level long enough to wrap to a third line';
    const out = wrapTextForForm(input, 22, monoFont, 1);
    expect(out).toEqual([
      '  a. Second level long',
      '     enough to wrap to',
      '     a third line',
    ]);
  });

  it('level-1 label "1." continuation hangs at the text start', () => {
    const input = '1. This is the first level paragraph that should wrap';
    const out = wrapTextForForm(input, 22, monoFont, 1);
    expect(out).toEqual([
      '1. This is the first',
      '   level paragraph',
      '   that should wrap',
    ]);
  });

  it('level-3 parenthesized label "(1)" continuation hangs after the parens', () => {
    const input = '    (1) Third level paragraph wraps here';
    const out = wrapTextForForm(input, 22, monoFont, 1);
    expect(out).toEqual([
      '    (1) Third level',
      '        paragraph',
      '        wraps here',
    ]);
  });

  it('plain leading whitespace (no label) is preserved on continuation', () => {
    // Pre-fix code dropped the leading "  " on continuation too — the
    // bug wasn't specific to SECNAV labels, any leading-WS prefix was
    // affected.
    const input = '  Plain paragraph long enough to wrap';
    const out = wrapTextForForm(input, 22, monoFont, 1);
    expect(out).toEqual(['  Plain paragraph long', '  enough to wrap']);
  });
});
