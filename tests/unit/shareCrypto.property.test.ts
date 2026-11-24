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
 * PBKDF2 is intentionally expensive. Use one real encryption/decryption per
 * case unless the case compares two ciphertexts.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { parseEncryptedShareFile, serializeEncryptedShareFile } from '@/lib/encryptedShareFile';
import {
  encryptSharePayload,
  decryptSharePayload,
  buildShareUrl,
  parseShareUrl,
  SHARE_HASH_PREFIX,
} from '@/lib/shareCrypto';

// Independently generated with the original byte layout and PBKDF2 cost,
// using Node's cipher API plus zlib for the compressed fixture.
const legacyShares = [
  {
    compressed: false,
    token: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGyImYp_vknPlZS8RuF85-zO9P2YvpVN2MRm3ioHJ10D63GaQVb7Wp2ieqzLMqrA87rsdvAvHpTjacMntc4ccCIdCkjZASnTf',
  },
  {
    compressed: true,
    token: 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6O3uk9wS9S7cp3EZgq9dxEGCY8vB80-FSNOiTddJQGoUE_VLzaBiPaVBnP8gMdRVuN4qOf_vlxUciGamRkB5Fhg_tl7vOilLK7rjtBBDryQ',
  },
];
const legacyPassword = 'legacy-fixture-passphrase';

afterEach(() => vi.restoreAllMocks());

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

  it('fails v2 authentication without re-deriving a key', async () => {
    const encrypted = await encryptSharePayload({ x: 1 }, 'right');
    const deriveKey = vi.spyOn(crypto.subtle, 'deriveKey');
    await expect(decryptSharePayload(encrypted, 'wrong')).rejects.toThrow(
      /Wrong password or invalid share link/
    );
    expect(deriveKey).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'PBKDF2', iterations: 600_000, hash: 'SHA-256' }),
      expect.anything(), expect.anything(), false, ['encrypt', 'decrypt'],
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
    const deriveKey = vi.spyOn(crypto.subtle, 'deriveKey');
    // A salt, IV and 15 tag bytes are still one byte short of a GCM envelope.
    const tooShort = 'A'.repeat(58);
    await expect(decryptSharePayload(tooShort, 'pw')).rejects.toThrow(/Invalid share link/);
    await expect(decryptSharePayload(`v2.${tooShort}`, 'pw')).rejects.toThrow(/Invalid share link/);
    expect(deriveKey).not.toHaveBeenCalled();
  });

  it('rejects malformed or unknown versions before deriving a key', async () => {
    const deriveKey = vi.spyOn(crypto.subtle, 'deriveKey');
    const token = legacyShares[0].token;
    for (const malformed of ['v2.', `v2.v2.${token}`, `v3.${token}`, `v2.600001.${token}`, `v2.${token}\n`]) {
      await expect(decryptSharePayload(malformed, legacyPassword)).rejects.toThrow(/Invalid share link/);
    }
    expect(deriveKey).not.toHaveBeenCalled();
  });

  it('cannot use the legacy key to open a token labeled v2', async () => {
    await expect(decryptSharePayload(`v2.${legacyShares[0].token}`, legacyPassword)).rejects.toThrow(/Wrong password/);
  });

  it.each(legacyShares)('opens a previously issued token with compressed=$compressed', async ({ compressed, token }) => {
    const received = compressed
      ? parseEncryptedShareFile(JSON.stringify({ kind: 'dondocs-encrypted-share', version: 1, payload: token }))
      : parseShareUrl(`https://example.com/#s=${token}`);
    expect(await decryptSharePayload(received!, legacyPassword)).toEqual({ subject: 'Synthetic legacy share', compressed });
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

  it('authenticates the v2 prefix and shares one URL-safe token in both delivery formats', async () => {
    const encrypt = vi.spyOn(crypto.subtle, 'encrypt');
    const data = { subject: 'Synthetic current share' };
    const encrypted = await encryptSharePayload(data, 'pw');
    expect(encrypted).toMatch(/^v2\.[A-Za-z0-9_-]+$/);
    expect(encrypt).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AES-GCM', additionalData: new TextEncoder().encode('v2.'),
    }), expect.anything(), expect.anything());
    const file = serializeEncryptedShareFile(encrypted);
    const received = parseEncryptedShareFile(new TextDecoder().decode(file));
    expect(received).toBe(parseShareUrl(buildShareUrl(encrypted)));
    expect(await decryptSharePayload(received, 'pw')).toEqual(data);
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
