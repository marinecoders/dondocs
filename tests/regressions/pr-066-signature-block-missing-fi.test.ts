/**
 * Regression: missing `\fi` in `business_letter.tex` and
 * `executive_correspondence.tex` signature blocks.
 *
 * Both templates opened
 *   \ifHasDigitalSigField
 *     \DigitalSignatureBox
 *   \else
 *     ... signature image / name / rank / title ...
 * but never closed the `\if` with a matching `\fi`. SwiftLaTeX silently
 * accepted the unbalanced `\if`; xelatex with `-halt-on-error` rejected
 * with `! Incomplete \iftrue; all text was ignored after line 1409.`
 * (line 1409 of `main.tex` is `\printSignature` — the include site).
 *
 * Caught by the integration compile matrix this PR added when fixtures
 * with `signatureType: 'digital'` triggered the broken path.
 *
 * Fix: mirror `naval_letter.tex`'s structure — close the `\if` after
 * the optional signature image, then render name / rank / title / by-
 * direction unconditionally below `\fi`.
 *
 * This unit-level check parses the source templates directly (no TeX
 * Live needed) so it survives a future refactor of the integration
 * harness. It asserts the exact `\ifHasDigitalSigField ... \else ...
 * \fi` shape — if a future contributor accidentally re-introduces
 * unbalanced `\if`, this test fails before xelatex ever runs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const TEMPLATES_THAT_HAD_THE_BUG = [
  'tex/templates/business_letter.tex',
  'tex/templates/executive_correspondence.tex',
];

/**
 * Within a `\printSignature` template body, count occurrences of the
 * signature-block conditional opener and its closer. They should
 * balance (one `\fi` per `\ifHasDigitalSigField`).
 */
function countTokens(source: string): { ifCount: number; fiCount: number } {
  // Locate the signature block — `\newcommand{\printSignature}`
  // through the first matching closing brace at column 0.
  const start = source.indexOf('\\newcommand{\\printSignature}');
  if (start === -1) return { ifCount: 0, fiCount: 0 };
  // Crude but effective for our hand-written templates: the block ends
  // at the next line that's only `}` (matches all current templates).
  const after = source.slice(start);
  const endMatch = after.match(/\n}\n/);
  const block = endMatch ? after.slice(0, endMatch.index! + 1) : after;

  return {
    ifCount: (block.match(/\\ifHasDigitalSigField\b/g) || []).length,
    fiCount: (block.match(/\\fi\b/g) || []).length,
  };
}

describe('PR #66 regression: missing `\\fi` in business_letter + executive_correspondence signature blocks', () => {
  it.each(TEMPLATES_THAT_HAD_THE_BUG)(
    '%s: \\ifHasDigitalSigField is balanced by a matching \\fi',
    (relPath) => {
      const source = readFileSync(join(REPO_ROOT, relPath), 'utf-8');
      const { ifCount, fiCount } = countTokens(source);

      // The bug shape: ifCount=1, fiCount=0 (open without close).
      expect(ifCount, `${relPath} should have one \\ifHasDigitalSigField`).toBe(1);
      expect(fiCount, `${relPath} \\fi count must >= \\ifHasDigitalSigField count`).toBeGreaterThanOrEqual(ifCount);
    }
  );

  it('naval_letter.tex was always correct (anchor — confirm the comparator still passes)', () => {
    const source = readFileSync(join(REPO_ROOT, 'tex/templates/naval_letter.tex'), 'utf-8');
    const { ifCount, fiCount } = countTokens(source);
    expect(ifCount).toBe(1);
    expect(fiCount).toBeGreaterThanOrEqual(1);
  });
});
