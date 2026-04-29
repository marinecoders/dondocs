/**
 * Property-based tests for the LaTeX escaper family.
 *
 * The escaper is the security boundary between user-typed content and the
 * LaTeX engine: a single un-escaped `\` in the wrong place becomes
 * arbitrary command execution. Random-input fuzzing here is the cheapest
 * way to find inputs that bypass the escape rules.
 *
 * Each property answers a specific failure mode:
 *   - Crashes / throws on weird input        → "never throws" properties
 *   - Un-escaped LaTeX specials in output    → "no naked specials" properties
 *   - Placeholders silently swallowed         → "placeholder name survives"
 *   - Round-trip data loss in subject wrap    → "preserves words"
 *
 * Where the existing inline escapeLatex has tight coverage in
 * `processBodyText` (the body-paragraph variant used by generator.ts),
 * we test both APIs because they share the protect-placeholders-then-
 * escape pattern and a regression in one is likely to mirror in the other.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  escapeLatex,
  escapeLatexUrl,
  wrapSubjectLine,
  formatSubjectForLatex,
  formatAddressForLatex,
  processBodyText,
} from '@/services/latex/escaper';

// Arbitrary that hits the high-pain inputs: LaTeX specials, control
// chars, embedded placeholders, very long runs, unicode. fast-check's
// default `fc.string()` skews ASCII-clean; this one stresses the parser.
const escapeStressArb = fc.oneof(
  fc.string(),
  fc.string({ unit: fc.constantFrom('\\', '&', '%', '$', '#', '_', '{', '}', '~', '^') }),
  fc.string({ unit: fc.constantFrom('a', '\\', '{', '}') }),
  fc
    .tuple(fc.string(), fc.stringMatching(/^[A-Z][A-Z0-9_]*$/), fc.string())
    .map(([before, name, after]) => `${before}{{${name}}}${after}`)
);

describe('escapeLatex', () => {
  it('never throws on any string input', () => {
    fc.assert(
      fc.property(escapeStressArb, (s) => {
        escapeLatex(s);
      }),
      { numRuns: 500 }
    );
  });

  it('handles undefined / null / empty without throwing', () => {
    expect(escapeLatex(undefined)).toBe('');
    expect(escapeLatex(null)).toBe('');
    expect(escapeLatex('')).toBe('');
  });

  it('output contains no un-escaped LaTeX specials (& % # _ outside escape sequences)', () => {
    // The check is conservative: every `&`, `%`, `#`, `_` in the output must
    // be preceded by a `\`. We don't enforce this for `{`, `}`, `~`, `^`, `$`
    // because the replacement output legitimately introduces braces (e.g.
    // `\textbackslash{}`) and the property would need a full LaTeX parser
    // to verify. The four characters here have no such ambiguity.
    fc.assert(
      fc.property(escapeStressArb, (s) => {
        const out = escapeLatex(s);
        for (const ch of ['&', '%', '#', '_']) {
          // Walk the string, every occurrence of `ch` must be preceded by `\`.
          let idx = out.indexOf(ch);
          while (idx !== -1) {
            const prev = out[idx - 1];
            // Skip placeholder-name occurrences inside `\fcolorbox{...}{...}`
            // — placeholders are restored AFTER escaping, so their content
            // is intentionally not re-escaped. Detect by looking at the
            // surrounding context.
            // For simplicity, treat the char as "OK" if preceded by \ OR if
            // it appears inside an obvious placeholder restoration block.
            const isEscaped = prev === '\\';
            expect(isEscaped, `un-escaped "${ch}" at index ${idx} in: ${out}`).toBe(true);
            idx = out.indexOf(ch, idx + 1);
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  it('preserves placeholder names ({{FOO_BAR}} → contains FOO_BAR or FOO\\_BAR)', () => {
    // Placeholders are wrapped in \fcolorbox for visual highlighting in the
    // generated PDF, but the NAME itself must survive — losing the name
    // means the user's variable silently disappears from the output.
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Z][A-Z0-9_]{0,20}$/), (name) => {
        const input = `prefix {{${name}}} suffix`;
        const out = escapeLatex(input);
        // The name appears either verbatim or with `_` escaped to `\_`
        // (the implementation re-escapes underscores in placeholder names
        // so they render in LaTeX text mode).
        const escapedName = name.replace(/_/g, '\\\\_');
        const re = new RegExp(`(${name}|${escapedName})`);
        expect(out).toMatch(re);
      }),
      { numRuns: 100 }
    );
  });
});

describe('escapeLatexUrl', () => {
  it('never throws on any string input', () => {
    fc.assert(
      fc.property(escapeStressArb, (s) => {
        escapeLatexUrl(s);
      }),
      { numRuns: 300 }
    );
  });

  it('handles undefined / null / empty without throwing', () => {
    expect(escapeLatexUrl(undefined)).toBe('');
    expect(escapeLatexUrl(null)).toBe('');
    expect(escapeLatexUrl('')).toBe('');
  });
});

describe('wrapSubjectLine', () => {
  it('never throws on any string input', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 200 }), (s, max) => {
        wrapSubjectLine(s, max);
      }),
      { numRuns: 300 }
    );
  });

  it('handles undefined / null / empty', () => {
    expect(wrapSubjectLine(undefined)).toEqual([]);
    expect(wrapSubjectLine(null)).toEqual([]);
    expect(wrapSubjectLine('')).toEqual([]);
  });

  it('preserves all non-whitespace characters in order', () => {
    // The function may slice mid-word for inputs containing a single word
    // longer than `maxLength` (the loop falls back to a hard cut when no
    // space is available before the boundary). So a "preserves words"
    // property would have false positives — instead, assert the strictly
    // weaker but still-meaningful invariant: all non-whitespace
    // characters survive in the same order. That catches any "drops a
    // character" regression without false-failing on legitimate hard
    // cuts.
    fc.assert(
      fc.property(
        fc
          .stringMatching(/^[A-Za-z0-9 ,.;:'-]{1,200}$/)
          .map((s) => s.replace(/\s+/g, ' ').trim())
          .filter((s) => s.length > 0),
        fc.integer({ min: 20, max: 80 }),
        (subject, max) => {
          const lines = wrapSubjectLine(subject, max);
          const inputChars = subject.replace(/\s+/g, '');
          const outputChars = lines.join('').replace(/\s+/g, '');
          expect(outputChars).toBe(inputChars);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('formatSubjectForLatex / formatAddressForLatex', () => {
  it('formatSubjectForLatex never throws', () => {
    fc.assert(
      fc.property(escapeStressArb, (s) => {
        formatSubjectForLatex(s);
      }),
      { numRuns: 200 }
    );
  });

  it('formatAddressForLatex never throws', () => {
    fc.assert(
      fc.property(escapeStressArb, fc.integer({ min: 20, max: 100 }), (s, max) => {
        formatAddressForLatex(s, max);
      }),
      { numRuns: 200 }
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

describe('processBodyText', () => {
  it('never throws on any string input', () => {
    fc.assert(
      fc.property(escapeStressArb, (s) => {
        processBodyText(s);
      }),
      { numRuns: 500 }
    );
  });

  it('preserves embedded placeholder names', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Z][A-Z0-9_]{0,20}$/), (name) => {
        const input = `Body content {{${name}}} more content.`;
        const out = processBodyText(input);
        const escapedName = name.replace(/_/g, '\\\\_');
        const re = new RegExp(`(${name}|${escapedName})`);
        expect(out).toMatch(re);
      }),
      { numRuns: 100 }
    );
  });

  it('rich-text markers convert in pairs (no orphan markers in output)', () => {
    // **bold**, *italic*, __underline__ markers should all be consumed by
    // the marker-to-LaTeX conversion. An orphan `**` or `__` in the output
    // means the conversion broke and the LaTeX engine will treat them as
    // literal text, producing visually-wrong but technically-valid output.
    // We test paired markers specifically.
    const wordArb = fc.stringMatching(/^[A-Za-z]{1,15}$/);
    fc.assert(
      fc.property(wordArb, wordArb, wordArb, (a, b, c) => {
        const input = `**${a}** *${b}* __${c}__`;
        const out = processBodyText(input);
        // No `**` should remain (consumed into \textbf{}).
        // Note: `*` alone might remain if the input has unpaired ones, but
        // for paired inputs we expect full consumption.
        expect(out).not.toMatch(/\*\*/);
        // No `__` should remain (consumed into \uline{}).
        expect(out).not.toMatch(/__/);
      }),
      { numRuns: 100 }
    );
  });
});
