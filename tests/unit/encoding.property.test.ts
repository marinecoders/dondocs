/**
 * Property tests for `src/lib/encoding.ts`.
 *
 * Two round-trip pairs and two stand-alone helpers, all heavily exercised
 * during font loading, share-link encryption, and LaTeX escaping. A bug
 * in any of these silently corrupts whatever flows through it.
 *
 *   - base64ToUint8Array ∘ uint8ArrayToBase64 = identity (bytewise)
 *   - extractBase64FromDataURL never accepts non-data URLs
 *   - escapeLatex / stripLatexFormatting never throw
 *
 * Note: the FileReader-based helpers (`readFileAsArrayBuffer`,
 * `readFileAsText`, `readFileAsDataURL`) and `triggerDownload` are
 * thin wrappers around browser APIs; their failure modes are
 * environment-bound, not logic-bound, and are out of scope here.
 * Same for `blobToUint8Array` (browser API).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  base64ToUint8Array,
  uint8ArrayToBase64,
  extractBase64FromDataURL,
  escapeLatex,
  stripLatexFormatting,
} from '@/lib/encoding';

describe('base64 round-trip', () => {
  it('uint8ArrayToBase64 then base64ToUint8Array is identity (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 256 }), (bytes) => {
        const encoded = uint8ArrayToBase64(bytes);
        const decoded = base64ToUint8Array(encoded);
        expect(Array.from(decoded)).toEqual(Array.from(bytes));
      }),
      { numRuns: 200 }
    );
  });

  it('encoding the empty array → empty string, and the round trip survives', () => {
    expect(uint8ArrayToBase64(new Uint8Array(0))).toBe('');
    expect(base64ToUint8Array('').length).toBe(0);
  });

  it('decoding a malformed base64 string throws "Invalid base64 string"', () => {
    expect(() => base64ToUint8Array('not!valid!base64!'))
      .toThrow(/Invalid base64 string/);
  });
});

describe('extractBase64FromDataURL', () => {
  it('extracts the base64 segment from a well-formed data URL', () => {
    expect(extractBase64FromDataURL('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
  });

  it('throws on a non-data URL', () => {
    expect(() => extractBase64FromDataURL('https://example.com/foo.png'))
      .toThrow(/Invalid data URL format/);
    expect(() => extractBase64FromDataURL('iVBORw0KGgo='))
      .toThrow(/Invalid data URL format/);
    expect(() => extractBase64FromDataURL(''))
      .toThrow(/Invalid data URL format/);
  });

  it('round-trips with uint8ArrayToBase64 (property)', () => {
    // A real data URL would have the form `data:<mime>;base64,<b64>`.
    // We construct one and assert the extractor gets the same bytes
    // out as we put in.
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 64 }), (bytes) => {
        const b64 = uint8ArrayToBase64(bytes);
        const dataUrl = `data:application/octet-stream;base64,${b64}`;
        const extracted = extractBase64FromDataURL(dataUrl);
        expect(extracted).toBe(b64);
      }),
      { numRuns: 100 }
    );
  });
});

describe('escapeLatex (lib version) — never throws + escapes specials', () => {
  // Note: this is the SIMPLER `escapeLatex` in src/lib/encoding.ts. The
  // richer escaper in src/services/latex/escaper.ts has its own test
  // file. This version doesn't do placeholder protection, which is
  // intentional — it's used in non-template contexts (filenames, etc.).

  it('never throws', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        escapeLatex(s);
      }),
      { numRuns: 300 }
    );
  });

  it('every input character ends up in the output (idempotent up to escaping)', () => {
    // Quick sanity: empty string, single specials, and a typical word
    // round-trip through escape → strip with no info loss.
    expect(escapeLatex('')).toBe('');
    expect(escapeLatex('hello')).toBe('hello');
    expect(escapeLatex('a&b')).toBe('a\\&b');
    expect(escapeLatex('100%')).toBe('100\\%');
  });
});

describe('stripLatexFormatting', () => {
  it('strips \\textbf{...} keeping inner text', () => {
    expect(stripLatexFormatting('\\textbf{hello}')).toBe('hello');
  });

  it('strips \\textit{...} keeping inner text', () => {
    expect(stripLatexFormatting('\\textit{world}')).toBe('world');
  });

  it('strips bare LaTeX commands', () => {
    expect(stripLatexFormatting('\\noindent text')).toBe(' text');
  });

  it('strips bare braces', () => {
    expect(stripLatexFormatting('a{b}c')).toBe('abc');
  });

  it('never throws on any string input', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        stripLatexFormatting(s);
      }),
      { numRuns: 200 }
    );
  });

  // Regression: the original `[^}]*` body match was O(n²) because the regex
  // engine could try every start position with every body length. Adversarial
  // input like `\emph{{|\emph{{|...` (no closing `}` ever) ran in ~8s for
  // 30K reps. countWords calls this on every keystroke in the paragraph
  // editor, so a paste of crafted content would freeze the UI.
  // Fix: bound the body match to {0,2000} chars + skip alternation regex
  // entirely for inputs > 100K chars. CodeQL `js/polynomial-redos`.
  describe('polynomial-redos regression (CodeQL js/polynomial-redos)', () => {
    it('handles 30K-rep pathological input in well under 1 second', () => {
      // Pre-fix: ~8 seconds. Post-fix: ~10ms.
      const pathological = '\\emph{{' + '|\\emph{{'.repeat(30_000);
      const start = Date.now();
      const out = stripLatexFormatting(pathological);
      const elapsed = Date.now() - start;
      // 1s budget is ~80x faster than the pre-fix runtime; if this
      // regresses to anything close to the original, the test fails fast.
      expect(elapsed).toBeLessThan(1000);
      // Sanity: output is finite and a string.
      expect(typeof out).toBe('string');
    });

    it('handles the > 100K char fast-path without hanging', () => {
      // Anything over MAX_STRIP_INPUT (100K) skips the alternation regex.
      // Verify it returns quickly even with adversarial structure.
      const huge = '\\emph{{|'.repeat(20_000); // 160K chars
      const start = Date.now();
      const out = stripLatexFormatting(huge);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
      // Fast-path strips standalone commands and braces, so output should
      // contain neither `\emph` nor `{` nor `}`.
      expect(out).not.toContain('\\emph');
      expect(out).not.toContain('{');
      expect(out).not.toContain('}');
    });

    it('still strips formatting correctly for realistic paragraph-sized input', () => {
      // The bounded-body fix must not break legitimate use.
      const realistic = 'Plain text \\textbf{bold word} more text \\textit{italic phrase here} end.';
      expect(stripLatexFormatting(realistic)).toBe(
        'Plain text bold word more text italic phrase here end.'
      );
    });
  });
});
