/**
 * Compile-level regression: paragraph text containing blank lines — pasted
 * multi-block text, with either Unix (\n) or Windows (\r\n) line endings —
 * must not abort the PDF compile.
 *
 * Field failure: a user pasted multi-paragraph test text into a paragraph
 * box and the compile died with:
 *
 *   ! LaTeX Error: There's no line here to end.
 *   l.9 \\
 *
 * TWO stacked root causes, isolated by bisecting the failing fixture's
 * emitted body.tex inside the real template:
 *
 * 1. `processBodyText` converted each `\n` to `\\`, so a blank line
 *    (`\n\n`) emitted a source line containing ONLY `\\`. main.tex sets
 *    `\raggedright` (naval-correspondence standard), which redefines `\\` —
 *    and under it a standalone `\\` is fatal. (Vanilla LaTeX accepts the
 *    same shape, which is why a minimal repro outside the template
 *    initially "proved" it harmless.)
 *
 * 2. CRLF input additionally leaked raw `\r` into the .tex (only `\n` was
 *    converted). TeX treats bare `\r` as a line ending, so `\r\n\r\n`
 *    produced a REAL empty source line (= \par) followed by `\\` — fatal
 *    even without \raggedright.
 *
 * Fix in `processBodyText`: normalize `\r\n?` → `\n` on entry; trim
 * leading/trailing newline runs; convert interior blank-line runs to
 * `\\[\baselineskip]` (one break + one blank line of space — visually
 * faithful, raggedright-safe, never a standalone `\\`).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { compileFixture, formatFailure } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';

const xelatexAvailable =
  spawnSync('xelatex', ['--version'], { encoding: 'utf-8' }).status === 0;

if (!xelatexAvailable) {
  console.warn(
    '[latex-compile-blank-lines] xelatex not found on PATH — suite will be SKIPPED.'
  );
}

describe('blank lines in paragraph text compile (raggedright standalone-\\\\ regression)', () => {
  it.skipIf(!xelatexAvailable)(
    'LF blank lines: multi-block paste with \\n\\n compiles to PDF',
    async () => {
      const store = buildBaseline('naval_letter');
      store.paragraphs = [
        {
          text:
            'Per reference (a), the following applies.\n\n' +
            'This second block was separated by a pasted blank line.\n' +
            'And a plain continuation line.',
          level: 0,
        },
        { text: 'A normal single-line paragraph after it.', level: 0 },
      ];

      const result = await compileFixture(store);
      expect(result.ok, formatFailure('lf-blank-lines', result)).toBe(true);
      expect(result.pdfBytes!.byteLength).toBeGreaterThan(1000);
    },
    120_000
  );

  it.skipIf(!xelatexAvailable)(
    'CRLF blank lines: Windows-clipboard paste with \\r\\n\\r\\n compiles to PDF',
    async () => {
      const store = buildBaseline('naval_letter');
      store.paragraphs = [
        {
          text:
            'Per reference (a), the following applies.\r\n\r\n' +
            'This second block was separated by a pasted blank line with CRLF endings.\r\n' +
            'And a plain CRLF continuation line.',
          level: 0,
        },
      ];

      const result = await compileFixture(store);
      expect(result.ok, formatFailure('crlf-blank-lines', result)).toBe(true);
      expect(result.pdfBytes!.byteLength).toBeGreaterThan(1000);
    },
    120_000
  );

  it.skipIf(!xelatexAvailable)(
    'leading/trailing newlines around paragraph text compile to PDF',
    async () => {
      const store = buildBaseline('naval_letter');
      store.paragraphs = [
        { text: '\n\nStarts after pasted leading blank lines and ends with some.\n\n', level: 0 },
      ];

      const result = await compileFixture(store);
      expect(result.ok, formatFailure('edge-newlines', result)).toBe(true);
      expect(result.pdfBytes!.byteLength).toBeGreaterThan(1000);
    },
    120_000
  );
});
