/**
 * Regression: blank lines in pasted paragraph text crashed the PDF compile
 * with `! LaTeX Error: There's no line here to end.` (`l.9 \\`).
 *
 * Root cause #1: the `\n` → `\\` conversion turned a blank line (`\n\n`)
 * into a source line containing ONLY `\\`. main.tex sets `\raggedright`
 * (naval-correspondence standard), which redefines `\\`; under it a
 * standalone `\\` is fatal. Root cause #2: CRLF input leaked raw `\r` into
 * the .tex (only `\n` was converted) — TeX treats bare `\r` as a line
 * ending, so `\r\n\r\n` produced a real empty source line (= \par)
 * followed by `\\`, fatal in any context.
 *
 * Fix in `processBodyText`: normalize `\r\n?` → `\n` on entry; trim
 * leading/trailing newline runs; convert interior blank-line runs to
 * `\\[\baselineskip]` (visual blank line, never a standalone `\\`).
 *
 * Compile-level proof: tests/integration/latex-compile-blank-lines.test.ts
 */
import { describe, it, expect } from 'vitest';
import { processBodyText } from '@/services/latex/escaper';

describe('blank-line / CRLF handling in processBodyText (no-line-here-to-end regression)', () => {
  it('never emits a standalone \\\\ source line for blank-line input', () => {
    const out = processBodyText('para one.\n\npara two.');
    // The fatal shape is a line consisting of only `\\` (raggedright-fatal).
    for (const line of out.split('\n')) {
      expect(line.trim(), `standalone \\\\ line in: ${JSON.stringify(out)}`).not.toBe('\\\\');
    }
    // The visual gap survives as a spaced line break.
    expect(out).toContain('para one.\\\\[\\baselineskip]\npara two.');
  });

  it('emits no \\r for CRLF input', () => {
    const out = processBodyText('line one\r\nline two\r\nline three');
    expect(out).not.toContain('\r');
  });

  it('CRLF input produces byte-identical output to LF input', () => {
    const lf = processBodyText('first block.\n\nsecond block.\nthird line.');
    const crlf = processBodyText('first block.\r\n\r\nsecond block.\r\nthird line.');
    expect(crlf).toBe(lf);
  });

  it('old-Mac bare \\r is treated as a newline, not passed through', () => {
    const out = processBodyText('alpha\rbeta');
    expect(out).not.toContain('\r');
    expect(out).toBe(processBodyText('alpha\nbeta'));
  });

  it('trims leading/trailing newline runs (no \\\\ butted against paragraph edges)', () => {
    const out = processBodyText('\n\ncontent line.\n\n');
    expect(out.startsWith('\\\\')).toBe(false);
    expect(out.endsWith('\\\\')).toBe(false);
    expect(out.endsWith('\\\\[\\baselineskip]\n')).toBe(false);
    expect(out).toContain('content line.');
  });

  it('runs of 3+ newlines collapse to a single spaced break (no stacked standalone \\\\)', () => {
    const out = processBodyText('a\n\n\n\nb');
    for (const line of out.split('\n')) {
      expect(line.trim()).not.toBe('\\\\');
    }
    expect((out.match(/\\\\\[\\baselineskip\]/g) || []).length).toBe(1);
  });

  it('single newlines still become plain \\\\ line breaks', () => {
    const out = processBodyText('line a\nline b');
    expect(out).toContain('line a\\\\\nline b');
  });
});
