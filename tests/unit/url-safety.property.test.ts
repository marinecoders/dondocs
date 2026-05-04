/**
 * Tests for `src/lib/url-safety.ts` (`safeUrl`).
 *
 * This is the chokepoint that prevents `javascript:`, `data:`,
 * `vbscript:`, `file:` and other dangerous URL schemes from reaching
 * the embedded clickable link annotations in generated PDFs and
 * DOCX files. A regression here is an actual security bug — issue
 * #17 was the canary, and this file pins down the behavior.
 *
 * The threat model is in the module docblock; we test against it.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { safeUrl } from '@/lib/url-safety';
import { adversarialString } from '../_helpers/fuzzArbitraries';

describe('safeUrl — scheme allowlist', () => {
  it('accepts http, https, mailto with valid input', () => {
    // `safeUrl` returns the cleaned input string (preserved as-is when
    // it has an explicit safe scheme). It does NOT canonicalize via the
    // URL constructor's normalization rules — that would alter user-
    // typed URLs in ways the user didn't expect.
    expect(safeUrl('https://example.com')).toBe('https://example.com');
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('mailto:foo@bar.com')).toBe('mailto:foo@bar.com');
    expect(safeUrl('https://example.com/path?a=1#frag')).toBe('https://example.com/path?a=1#frag');
  });

  it('rejects javascript: scheme', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('JavaScript:alert(1)')).toBeNull();
    expect(safeUrl('JAVASCRIPT:alert(1)')).toBeNull();
  });

  it('rejects data: scheme', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeUrl('data:image/png;base64,iVBORw0KGgo=')).toBeNull();
  });

  it('rejects vbscript: scheme', () => {
    expect(safeUrl('vbscript:msgbox("xss")')).toBeNull();
  });

  it('rejects file: scheme (local file disclosure)', () => {
    expect(safeUrl('file:///etc/passwd')).toBeNull();
    expect(safeUrl('file:///C:/Windows/System32/config.sys')).toBeNull();
  });

  it('rejects control-char obfuscation: java\\tscript:..., etc.', () => {
    // Browsers strip control chars from schemes during parsing, so
    // `java\tscript:` resolves to `javascript:`. The function strips
    // first then validates, so these get rejected.
    expect(safeUrl('java\tscript:alert(1)')).toBeNull();
    expect(safeUrl('java\nscript:alert(1)')).toBeNull();
    expect(safeUrl('java\rscript:alert(1)')).toBeNull();
    expect(safeUrl('java\0script:alert(1)')).toBeNull();
  });

  it('rejects malformed URLs', () => {
    // `safeUrl` canonicalizes bare host-shaped strings by prepending
    // `https://` (so `not-a-url` → `https://not-a-url`). That's a
    // reachability nicety, not a security hole — the result is still
    // an https URL, not a dangerous scheme. Pure-junk inputs that
    // can't be canonicalized do return null.
    expect(safeUrl('://example.com')).toBeNull();
    expect(safeUrl('http://')).toBeNull();
    expect(safeUrl(':')).toBeNull();
  });

  it('returns null for empty / null / undefined input', () => {
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl('   ')).toBeNull();
  });

  it('never throws on adversarial input (security: errors → null, not crash)', () => {
    fc.assert(
      fc.property(adversarialString, (s) => {
        // Either returns a string OR returns null. Never throws.
        const result = safeUrl(s);
        expect(result === null || typeof result === 'string').toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('output (when non-null) NEVER starts with a dangerous scheme', () => {
    // Property: whatever safeUrl returns, it's safe. The defensive
    // claim of the entire module rolled up into a fuzzable invariant.
    const DANGEROUS = ['javascript:', 'data:', 'vbscript:', 'file:', 'about:', 'jar:'];
    fc.assert(
      fc.property(adversarialString, (s) => {
        const out = safeUrl(s);
        if (out !== null) {
          for (const danger of DANGEROUS) {
            expect(out.toLowerCase().startsWith(danger), `unsafe scheme passed: ${out}`).toBe(false);
          }
        }
      }),
      { numRuns: 500 }
    );
  });
});
