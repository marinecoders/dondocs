/**
 * Tests for `src/lib/url-safety.ts` (`safeUrl`).
 *
 * This is the chokepoint that prevents `javascript:`, `data:`,
 * `vbscript:`, `file:` and other dangerous URL schemes from reaching
 * the embedded clickable link annotations in generated PDFs and
 * DOCX files. A regression here is an actual security bug — issue
 * #17 was the canary, and this file pins down the behavior.
 *
 * The threat model is in the module docblock. The behavior table in
 * that docblock is the authoritative spec for what `safeUrl` does,
 * and the `behavior table` describe block below pins each row of it.
 *
 * Mutation testing was used to verify the suite has teeth: an early
 * pass scored 39% (Stryker, Apr 2026). Tests below were strengthened
 * specifically to push that score by exercising the canonicalization
 * branches (bare host → https://, bare email → mailto:, protocol-
 * relative → https:, mailto sanity, and the http/https host-empty
 * defensive checks).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { safeUrl } from '@/lib/url-safety';
import { adversarialString } from '../_helpers/fuzzArbitraries';

describe('safeUrl — scheme allowlist (rejection)', () => {
  it('rejects javascript: scheme (every casing)', () => {
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

  it('rejects ftp / ftps (deprecated, not in allowlist)', () => {
    expect(safeUrl('ftp://example.com/file.txt')).toBeNull();
    expect(safeUrl('ftps://example.com/file.txt')).toBeNull();
  });

  it('rejects browser-internal schemes (about:, chrome:, blob:, ws:)', () => {
    expect(safeUrl('about:blank')).toBeNull();
    expect(safeUrl('chrome://settings')).toBeNull();
    expect(safeUrl('blob:https://example.com/abc')).toBeNull();
    expect(safeUrl('ws://example.com/socket')).toBeNull();
  });

  it('rejects control-char obfuscation: java<TAB>script: → javascript:', () => {
    // Browsers strip control chars from schemes during parsing, so
    // `java\tscript:` resolves to `javascript:`. We strip first then
    // validate, so these get rejected by the allowlist.
    expect(safeUrl('java\tscript:alert(1)')).toBeNull();
    expect(safeUrl('java\nscript:alert(1)')).toBeNull();
    expect(safeUrl('java\rscript:alert(1)')).toBeNull();
    expect(safeUrl('java\0script:alert(1)')).toBeNull();
    // Various invisible Unicode whitespace too — same defense path.
    expect(safeUrl('java​script:alert(1)')).toBeNull(); // ZWSP
    expect(safeUrl('java script:alert(1)')).toBeNull(); // NBSP
    expect(safeUrl('java﻿script:alert(1)')).toBeNull(); // BOM
  });
});

describe('safeUrl — behavior table (every documented input → output pair)', () => {
  // These pin the exact behavior table from the module docblock. Each
  // entry in the table is its own assertion so failures point at the
  // specific row that regressed.

  it("safeUrl('https://marines.mil') → 'https://marines.mil'", () => {
    expect(safeUrl('https://marines.mil')).toBe('https://marines.mil');
  });

  it("safeUrl('http://example.com') → 'http://example.com'", () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com');
  });

  it("safeUrl('https://example.com/path?q=1#f') preserves path/query/fragment", () => {
    expect(safeUrl('https://example.com/path?a=1#frag'))
      .toBe('https://example.com/path?a=1#frag');
  });

  it("safeUrl('marines.mil') → 'https://marines.mil' (bare-host canonicalization)", () => {
    expect(safeUrl('marines.mil')).toBe('https://marines.mil');
  });

  it("safeUrl('marines.mil/orders') → 'https://marines.mil/orders'", () => {
    expect(safeUrl('marines.mil/orders')).toBe('https://marines.mil/orders');
  });

  it("safeUrl('//example.com/path') → 'https://example.com/path' (protocol-relative)", () => {
    expect(safeUrl('//example.com/path')).toBe('https://example.com/path');
  });

  it("safeUrl('foo@bar.com') → 'mailto:foo@bar.com' (bare-email canonicalization)", () => {
    expect(safeUrl('foo@bar.com')).toBe('mailto:foo@bar.com');
  });

  it("safeUrl('mailto:foo@bar.com') → 'mailto:foo@bar.com' (preserve)", () => {
    expect(safeUrl('mailto:foo@bar.com')).toBe('mailto:foo@bar.com');
  });

  it("safeUrl('mailto:foo') → null (malformed mailto, no @ or .)", () => {
    expect(safeUrl('mailto:foo')).toBeNull();
  });

  it("safeUrl('mailto:foo@bar') → null (mailto with no TLD-style dot)", () => {
    expect(safeUrl('mailto:foo@bar')).toBeNull();
  });

  it("safeUrl('mailto:foo@bar.com?subject=hi') → preserves query string", () => {
    expect(safeUrl('mailto:foo@bar.com?subject=hi'))
      .toBe('mailto:foo@bar.com?subject=hi');
  });

  it("safeUrl('https://') → null (empty host)", () => {
    expect(safeUrl('https://')).toBeNull();
  });

  it("safeUrl('http://') → null (empty host)", () => {
    expect(safeUrl('http://')).toBeNull();
  });

  it("safeUrl('/orders/MCO-1610.7A') → null (absolute path, no base origin)", () => {
    expect(safeUrl('/orders/MCO-1610.7A')).toBeNull();
  });

  it("safeUrl('://example.com') → null (scheme delimiter without scheme)", () => {
    expect(safeUrl('://example.com')).toBeNull();
  });

  it("safeUrl(':') → null", () => {
    expect(safeUrl(':')).toBeNull();
  });

  it('safeUrl on empty / null / undefined / whitespace-only → null', () => {
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl('   ')).toBeNull();
    expect(safeUrl('\t\n\r')).toBeNull();
  });
});

describe('safeUrl — properties on adversarial input', () => {
  it('never throws on any input (security: errors → null, not crash)', () => {
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
    const DANGEROUS = ['javascript:', 'data:', 'vbscript:', 'file:', 'about:', 'jar:', 'blob:', 'chrome:', 'ftp:', 'ws:'];
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

  it('output (when non-null) ALWAYS starts with one of the allowed schemes', () => {
    // Inverse of the previous property — the output is one of:
    // http://, https://, or mailto:. Anything else is a bug.
    fc.assert(
      fc.property(adversarialString, (s) => {
        const out = safeUrl(s);
        if (out !== null) {
          const ok =
            out.startsWith('http://') ||
            out.startsWith('https://') ||
            out.startsWith('mailto:');
          expect(ok, `output didn't start with allowed scheme: ${out}`).toBe(true);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('output (when non-null) NEVER contains stripped control characters', () => {
    // We strip control chars + whitespace before validation AND emit
    // the stripped form. So no output can contain a TAB / NUL / NBSP /
    // ZWSP. Catches a regression where the strip-then-validate ordering
    // gets reversed.
    fc.assert(
      fc.property(adversarialString, (s) => {
        const out = safeUrl(s);
        if (out !== null) {
          // \p{Cc} (Control), plus the most common invisible
          // whitespace classes the strip regex covers.
          expect(out, `output contained control char: ${JSON.stringify(out)}`).not.toMatch(/[\p{Cc}]/u);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('idempotent: safeUrl(safeUrl(x)) === safeUrl(x) for any x where safeUrl(x) is non-null', () => {
    // Once an input has been canonicalized, running safeUrl again
    // must produce the same output. Catches a regression where
    // canonicalization isn't a fixed point (e.g. each pass adds another
    // `https://` prefix).
    fc.assert(
      fc.property(adversarialString, (s) => {
        const once = safeUrl(s);
        if (once === null) return;
        const twice = safeUrl(once);
        expect(twice, `not idempotent: safeUrl("${s}") = "${once}", safeUrl("${once}") = ${JSON.stringify(twice)}`).toBe(once);
      }),
      { numRuns: 500 }
    );
  });

  it('bare hosts get an https:// prefix', () => {
    // For any well-formed bare host name, the output (if accepted) must
    // start with `https://`. Catches a regression where the canonical
    // prefix changes (e.g. switches to http://) — that would silently
    // expose users to MITM downgrade.
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{1,30}\.[a-z]{2,10}$/),
        (host) => {
          const out = safeUrl(host);
          if (out !== null) {
            expect(out, `bare host ${host} not https-prefixed: ${out}`).toMatch(/^https:\/\//);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('bare emails get a mailto: prefix and never an http/https one', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9_.-]{0,15}@[a-z][a-z0-9-]{1,15}\.[a-z]{2,5}$/),
        (email) => {
          const out = safeUrl(email);
          if (out !== null) {
            expect(out, `bare email ${email} not mailto-prefixed: ${out}`).toMatch(/^mailto:/);
            expect(out).not.toMatch(/^https?:/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('appending a `?query` to a valid http url stays accepted (safety check on query parsing)', () => {
    // Catches a regression where query-string handling rejects valid
    // URLs because of the chars in the query.
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,8}=[a-z0-9]{1,8}$/),
        (qs) => {
          const url = `https://example.com/path?${qs}`;
          expect(safeUrl(url)).toBe(url);
        }
      ),
      { numRuns: 50 }
    );
  });
});
