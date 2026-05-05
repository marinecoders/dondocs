/**
 * Property tests for `src/lib/shareCrypto.ts`.
 *
 * Share links are end-to-end encrypted with a user-supplied password
 * (PBKDF2 + AES-GCM, plaintext is DEFLATE-compressed JSON). Two failure
 * modes matter:
 *
 *   1. Round-trip data loss — encrypt(x, p) → decrypt(_, p) must return
 *      a value deeply equal to `x`. A regression here silently corrupts
 *      every share link.
 *
 *   2. Tampering / wrong-password silence — decrypt with the wrong
 *      password OR a mutated ciphertext MUST throw, not return
 *      partial-or-garbage data. AES-GCM provides authenticated
 *      encryption so this is a property of the underlying primitive,
 *      but we pin it down here so a future refactor that swaps GCM for
 *      a non-AEAD mode (e.g. CBC) fails CI loudly.
 *
 * Slow-test discipline: PBKDF2 is intentionally expensive (~120k
 * iterations) so encrypt/decrypt is ~50–100 ms per call. We cap
 * `numRuns` at 10 — the property is highly redundant per call and a
 * single failure is enough to flag a regression. Parallelizing across
 * multiple workers (vitest pools by default) keeps wall time tolerable.
 */
import { describe, it, expect } from 'vitest';
import {
  encryptSharePayload,
  decryptSharePayload,
  buildShareUrl,
  parseShareUrl,
  SHARE_HASH_PREFIX,
} from '@/lib/shareCrypto';

describe('encryptSharePayload + decryptSharePayload', () => {
  it('round-trips a simple object', async () => {
    const data = { hello: 'world', n: 42 };
    const encrypted = await encryptSharePayload(data, 'pw1234');
    const decrypted = await decryptSharePayload(encrypted, 'pw1234');
    expect(decrypted).toEqual(data);
  });

  it('round-trips a deeply nested document-shaped object', async () => {
    const data = {
      formData: {
        from: 'SSgt John A. Smith',
        subject: 'Counseling — PFT failure',
        unitAddress: 'PSC BOX 8050, CHERRY POINT, NC 28533-0050',
      },
      paragraphs: [
        { level: 0, text: '1. The Marine failed to meet PFT standards.' },
        { level: 1, text: '   a. Pull-ups: 2 (minimum 4 required)' },
      ],
      classification: 'cui',
    };
    const encrypted = await encryptSharePayload(data, 'a-stronger-password');
    const decrypted = await decryptSharePayload(encrypted, 'a-stronger-password');
    expect(decrypted).toEqual(data);
  });

  it('round-trips an empty object', async () => {
    const encrypted = await encryptSharePayload({}, 'password');
    const decrypted = await decryptSharePayload(encrypted, 'password');
    expect(decrypted).toEqual({});
  });

  it('decrypt with wrong password throws', async () => {
    const encrypted = await encryptSharePayload({ x: 1 }, 'right');
    await expect(decryptSharePayload(encrypted, 'wrong')).rejects.toThrow(
      /Wrong password or invalid share link/
    );
  });

  it('decrypt with a tampered ciphertext throws (AES-GCM authenticated)', async () => {
    const encrypted = await encryptSharePayload({ x: 1 }, 'pw');
    // Flip a byte in the middle of the encrypted payload (not the salt
    // or IV — those would just produce a wrong key, which already
    // throws). The middle bytes are inside the ciphertext, so AES-GCM's
    // tag check should reject it.
    const mid = Math.floor(encrypted.length / 2);
    const flipChar = encrypted[mid] === 'A' ? 'B' : 'A';
    const tampered = encrypted.slice(0, mid) + flipChar + encrypted.slice(mid + 1);
    await expect(decryptSharePayload(tampered, 'pw')).rejects.toThrow(
      /Wrong password or invalid share link/
    );
  });

  it('encrypt with empty password throws', async () => {
    await expect(encryptSharePayload({}, '')).rejects.toThrow(/Password is required/);
  });

  it('decrypt with empty password throws', async () => {
    await expect(decryptSharePayload('whatever', '')).rejects.toThrow(/Password is required/);
  });

  it('decrypt of a too-short payload throws', async () => {
    // Below SALT(16) + IV(12) + 1 = 29 bytes raw, base64url-encoded
    // works out to ~40 chars. Anything shorter can't possibly be a
    // valid payload — should throw at base64 decode OR at the length
    // check inside the function. Either way, MUST throw, MUST NOT
    // return partial data.
    await expect(decryptSharePayload('short', 'pw')).rejects.toThrow();
  });

  it('two encryptions of the same data produce different ciphertexts (random salt + IV)', async () => {
    // Salt and IV are randomized per call, so identical plaintexts
    // produce different ciphertexts — a basic "not deterministic"
    // sanity check. If two calls produced the same output, the
    // encryption wouldn't be IND-CPA secure.
    const a = await encryptSharePayload({ x: 1 }, 'pw');
    const b = await encryptSharePayload({ x: 1 }, 'pw');
    expect(a).not.toBe(b);
    // Both still decrypt to the same data.
    expect(await decryptSharePayload(a, 'pw')).toEqual({ x: 1 });
    expect(await decryptSharePayload(b, 'pw')).toEqual({ x: 1 });
  });

  it('encrypted output is URL-safe (base64url, no `+`, `/`, or `=` padding)', async () => {
    const encrypted = await encryptSharePayload({ x: 1 }, 'pw');
    expect(encrypted).not.toMatch(/[+/=]/);
    expect(encrypted).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('buildShareUrl + parseShareUrl', () => {
  it('round-trip a typical payload', () => {
    const payload = 'AbCd-_1234';
    const url = buildShareUrl(payload);
    expect(parseShareUrl(url)).toBe(payload);
  });

  it('parseShareUrl extracts payload from full URL', () => {
    expect(parseShareUrl(`https://example.com/#${SHARE_HASH_PREFIX}xyz123`)).toBe('xyz123');
  });

  it('parseShareUrl extracts payload from hash-only', () => {
    expect(parseShareUrl(`#${SHARE_HASH_PREFIX}xyz123`)).toBe('xyz123');
  });

  it('parseShareUrl extracts payload from raw payload-with-prefix', () => {
    expect(parseShareUrl(`${SHARE_HASH_PREFIX}xyz123`)).toBe('xyz123');
  });

  it('parseShareUrl returns null for non-share URLs', () => {
    expect(parseShareUrl('https://example.com/')).toBeNull();
    expect(parseShareUrl('#other=foo')).toBeNull();
    expect(parseShareUrl('')).toBeNull();
  });

  it('buildShareUrl always emits the share prefix', () => {
    const url = buildShareUrl('payload');
    expect(url).toContain(`#${SHARE_HASH_PREFIX}payload`);
  });
});
