/**
 * Regression: catastrophic ReDoS in `addSignatureField`'s text-extraction
 * regex. CodeQL `js/redos` (severity: error).
 *
 * The vulnerable regex was:
 *   `/\[((?:[^[\]]*|\([^)]*\))*)\]TJ/g`
 * applied to PDF content-stream text. Both alternation branches matched
 * paren-free chunks, so a content stream like `[(a)(a)(a)...` with no
 * closing `]TJ` triggered exponential backtracking — n=15 took ~81
 * seconds in benchmark (n=20 effectively hung).
 *
 * `addSignatureField` runs on user-uploaded enclosure PDFs (via
 * `mergeEnclosures` in App.tsx) so a crafted malicious PDF would lock
 * the worker. This is the most severe finding in the PR #69 cleanup.
 *
 * Fix: change the alternation to be exclusive on the first character —
 * `[^[\]()]` (single non-special char) vs `\((?:\\.|[^\\)])*\)` (full
 * literal string with proper PDF escape handling). No backtracking
 * possible; match time is linear in input size.
 *
 * This test reconstructs the exact regex pattern used in
 * `addSignatureField.ts` (since it's a private const) and asserts the
 * adversarial-input timing budget. If a future refactor reintroduces
 * the catastrophic alternation, this test fails fast.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

describe('PR #69 — tjRegex ReDoS regression (CodeQL js/redos)', () => {
  it('source uses the bounded alternation pattern (not the catastrophic one)', () => {
    // Pin the source-level shape so a future refactor can't accidentally
    // revert to `[^[\]]*` (the wide-greedy branch that overlaps with
    // `\([^)]*\)` and triggers exponential backtracking).
    const src = readFileSync(
      join(REPO_ROOT, 'src/services/pdf/addSignatureField.ts'),
      'utf8'
    );
    // Match the actual regex assignment line (not docstring mentions).
    // The fixed assignment must contain the exclusive-alternation form.
    const assignmentLine = src
      .split('\n')
      .find((l) => l.includes('const tjRegex ='));
    expect(assignmentLine).toBeDefined();
    expect(assignmentLine).toContain('[^[\\]()]');
    // Also confirm the catastrophic `[^[\]]*` shape is NOT in the
    // assignment (allowed in surrounding docstrings that explain the
    // history of the fix).
    expect(assignmentLine).not.toMatch(/\[\^\[\\\]\]\*/);
  });

  it('regex completes in <1s on the adversarial input that previously hung', () => {
    // Reconstruct the exact regex used in addSignatureField.ts. If the
    // source regex changes, this test fails fast in the previous
    // assertion.
    const tjRegex = /\[((?:[^[\]()]|\((?:\\.|[^\\)])*\))*)\]TJ/g;

    // The catastrophic case: many `(a)` paren groups inside `[...` with
    // no closing `]TJ`. Pre-fix, n=15 took 81s. Post-fix should be ms.
    const adversarial = '[' + '(a)'.repeat(50_000); // No `]TJ` — never matches.
    const start = Date.now();
    tjRegex.exec(adversarial);
    const elapsed = Date.now() - start;
    // 1s is ~80x faster than the pre-fix runtime for n=15. If this
    // regresses, the test fails fast.
    expect(elapsed).toBeLessThan(1000);
  });

  it('regex still correctly extracts TJ array contents on real-world PDF input', () => {
    // SwiftLaTeX-style TJ arrays: literal strings, kerning numbers,
    // escaped close-parens (`\)` is a valid PDF literal-string escape).
    const tjRegex = /\[((?:[^[\]()]|\((?:\\.|[^\\)])*\))*)\]TJ/g;

    const cases: Array<[string, string]> = [
      ['[(hello)(world)-100(more text)]TJ', '(hello)(world)-100(more text)'],
      ['[(Just one)]TJ', '(Just one)'],
      ['[ -50 (a) -100 (b) -50 (c) ]TJ', ' -50 (a) -100 (b) -50 (c) '],
      ['[]TJ', ''],
      ['[()]TJ', '()'],
      // PDF literal-string escapes — these MUST be preserved as a single
      // capture, not break out of the literal-string match.
      ['[(escaped \\)paren)]TJ', '(escaped \\)paren)'],
      ['[(escaped \\(paren)]TJ', '(escaped \\(paren)'],
      ['[(backslash \\\\ here)]TJ', '(backslash \\\\ here)'],
    ];

    for (const [input, expected] of cases) {
      tjRegex.lastIndex = 0;
      const match = tjRegex.exec(input);
      expect(match?.[1], `for input ${JSON.stringify(input)}`).toBe(expected);
    }
  });
});
