/**
 * Password-based encryption for share links.
 * Uses Web Crypto: PBKDF2 (key derivation) + AES-GCM (encryption).
 * Payload format: base64url(salt(16) || iv(12) || ciphertext).
 *
 * Plaintext inside the ciphertext is DEFLATE-compressed JSON. We identify
 * compressed vs legacy payloads by byte-sniffing the first decrypted byte —
 * DEFLATE streams begin with 0x78 (zlib header) while raw JSON always begins
 * with 0x7B (`{`). This keeps the URL format unchanged, so share links
 * produced before this change still decrypt.
 */

import pako from 'pako';

const PBKDF2_ITERATIONS = 120_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

// 0x78 is the first byte of a zlib-wrapped DEFLATE stream (second byte varies
// by compression level: 0x9C for default, 0xDA for best). JSON.stringify on
// an object/array/string always produces `{`, `[`, or `"` — none of which
// collide with 0x78, so sniffing is unambiguous for the payloads we produce.
const DEFLATE_MAGIC = 0x78;

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a JSON-serializable object with a password.
 * Returns a base64url string suitable for use in a URL fragment.
 */
export async function encryptSharePayload(data: object, password: string): Promise<string> {
  if (!password || password.length < 1) {
    throw new Error('Password is required');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  // Compress the JSON before encryption. Session payloads are highly
  // repetitive (LaTeX templates, repeated field names, form labels) and
  // typically compress 3-5x, which directly reduces share-link length —
  // browsers choke on URLs past ~8 KB and some messaging apps truncate
  // earlier. pako.deflate is already in the bundle for enclosure PDF
  // decompression, so this adds no bundle weight.
  const jsonBytes = enc.encode(JSON.stringify(data));
  const plaintext = pako.deflate(jsonBytes);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
  return base64urlEncode(combined);
}

/**
 * Decrypt a base64url-encoded share payload with a password.
 * Returns the parsed object.
 */
export async function decryptSharePayload(
  base64url: string,
  password: string
): Promise<object> {
  if (!password || password.length < 1) {
    throw new Error('Password is required');
  }
  const combined = base64urlDecode(base64url);
  if (combined.length < SALT_LENGTH + IV_LENGTH + 1) {
    throw new Error('Invalid share link');
  }
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(password, salt);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    const decryptedBytes = new Uint8Array(decrypted);
    // Byte-sniff for DEFLATE header. New payloads (post-compression change)
    // start with 0x78; legacy payloads are raw UTF-8 JSON that always start
    // with `{` (0x7B) or `[` (0x5B). We keep decoding legacy so old links
    // users have already shared still work.
    const jsonBytes = decryptedBytes[0] === DEFLATE_MAGIC
      ? pako.inflate(decryptedBytes)
      : decryptedBytes;
    const decoded = new TextDecoder().decode(jsonBytes);
    return JSON.parse(decoded) as object;
  } catch {
    throw new Error('Wrong password or invalid share link');
  }
}

/** Prefix used in the URL hash for share links */
export const SHARE_HASH_PREFIX = 's=';

/**
 * Build the share URL for the current origin.
 */
export function buildShareUrl(encryptedBase64url: string): string {
  const base = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname || '/'}`
    : '';
  const hash = `#${SHARE_HASH_PREFIX}${encryptedBase64url}`;
  return `${base.replace(/\/$/, '')}${hash}`;
}

/**
 * Parse the encrypted payload from a share URL or hash string.
 * Returns the base64url payload or null.
 */
export function parseShareUrl(urlOrHash: string): string | null {
  try {
    const hashPart = urlOrHash.includes('#')
      ? urlOrHash.slice(urlOrHash.indexOf('#'))
      : urlOrHash.startsWith('#') ? urlOrHash : `#${urlOrHash}`;
    if (hashPart.startsWith('#' + SHARE_HASH_PREFIX)) {
      return hashPart.slice(1 + SHARE_HASH_PREFIX.length);
    }
    return null;
  } catch {
    return null;
  }
}
