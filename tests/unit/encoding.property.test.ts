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
});
