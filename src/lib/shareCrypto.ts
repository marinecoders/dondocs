/**
 * Password-based encryption for share links and files.
 * New tokens: v2.base64url(salt(16) || iv(12) || AES-GCM ciphertext and tag).
 * The version prefix is authenticated and selects a fixed PBKDF2 cost.
 * Legacy tokens have no prefix and may contain uncompressed JSON.
 */

import pako from 'pako';
import { uint8ArrayToBase64 } from './encoding';

export const MAX_SHARE_PLAINTEXT_BYTES = 110 * 1024 * 1024;
export const MAX_ENCRYPTED_SHARE_LENGTH = 140 * 1024 * 1024;
export const MAX_SHARE_URL_LENGTH = 8000;

const LEGACY_PBKDF2_ITERATIONS = 120_000;
const V2_PBKDF2_ITERATIONS = 600_000;
const V2_PREFIX = 'v2.';
const V2_ADDITIONAL_DATA = new TextEncoder().encode(V2_PREFIX);
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const CIPHERTEXT_OFFSET = SALT_LENGTH + IV_LENGTH;
const KEY_LENGTH = 256;

// 0x78 is the first byte of a zlib-wrapped DEFLATE stream (second byte varies
// by compression level: 0x9C for default, 0xDA for best). JSON.stringify on
// an object/array/string always produces `{`, `[`, or `"` — none of which
// collide with 0x78, so sniffing is unambiguous for the payloads we produce.
const DEFLATE_MAGIC = 0x78;

function base64urlEncode(bytes: Uint8Array): string {
  return uint8ArrayToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array<ArrayBuffer> {
  if (!str || /[^A-Za-z0-9_-]/.test(str) || str.length % 4 === 1) {
    throw new Error('Invalid share link');
  }
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

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
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
      salt,
      iterations,
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
 * Returns a versioned token suitable for use in a URL fragment.
 */
export async function encryptSharePayload(data: object, password: string): Promise<string> {
  if (!password || password.length < 1) {
    throw new Error('Password is required');
  }
  const enc = new TextEncoder();
  // Compress the JSON before encryption. Session payloads are highly
  // repetitive (LaTeX templates, repeated field names, form labels) and
  // typically compress 3-5x, which directly reduces share-link length —
  // browsers choke on URLs past ~8 KB and some messaging apps truncate
  // earlier. pako.deflate is already in the bundle for enclosure PDF
  // decompression, so this adds no bundle weight.
  const jsonBytes = enc.encode(JSON.stringify(data));
  if (jsonBytes.byteLength > MAX_SHARE_PLAINTEXT_BYTES) throw new Error('This shared document exceeds the 110 MB expanded transfer limit.');
  const plaintext = pako.deflate(jsonBytes);
  const envelopeLength = CIPHERTEXT_OFFSET + plaintext.byteLength + TAG_LENGTH;
  if (V2_PREFIX.length + Math.ceil(envelopeLength * 4 / 3) > MAX_ENCRYPTED_SHARE_LENGTH) {
    throw new Error('This encrypted share exceeds the transfer limit.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt, V2_PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: TAG_LENGTH * 8, additionalData: V2_ADDITIONAL_DATA },
    key,
    plaintext
  );
  const combined = new Uint8Array(envelopeLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LENGTH);
  combined.set(new Uint8Array(ciphertext), CIPHERTEXT_OFFSET);
  return V2_PREFIX + base64urlEncode(combined);
}

/** Streaming inflation stops before a compressed payload can exceed its allocation budget. */
export function decodeSharePlaintext(bytes: Uint8Array, limit = MAX_SHARE_PLAINTEXT_BYTES): object {
  const maximum = Math.min(limit, MAX_SHARE_PLAINTEXT_BYTES);
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Invalid share transfer limit.');
  let jsonBytes = bytes;
  if (bytes[0] === DEFLATE_MAGIC) {
    const inflater = new pako.Inflate({ chunkSize: 64 * 1024 });
    let total = 0;
    let complete = false;
    const chunks: Uint8Array[] = [];
    inflater.onData = (chunk: Uint8Array) => {
      total += chunk.byteLength;
      if (total > maximum) throw new Error('This shared document exceeds the expanded transfer limit.');
      chunks.push(chunk);
    };
    inflater.onEnd = (status: number) => { complete = status === 0; };
    inflater.push(bytes, true);
    if (!complete) throw new Error('Invalid compressed share.');
    jsonBytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { jsonBytes.set(chunk, offset);offset += chunk.byteLength; }
  } else if (bytes.byteLength > maximum) throw new Error('This shared document exceeds the expanded transfer limit.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)) as object;
}

/**
 * Decrypt a share token with the parameters of its envelope version.
 * Returns the parsed object.
 */
export async function decryptSharePayload(
  token: string,
  password: string
): Promise<object> {
  if (!password || password.length < 1) {
    throw new Error('Password is required');
  }
  if (token.length > MAX_ENCRYPTED_SHARE_LENGTH) {
    throw new Error('This encrypted share exceeds the transfer limit.');
  }
  // A period is outside the legacy base64url alphabet. Unknown versions and
  // malformed v2 tokens are rejected without deriving a legacy key.
  const isV2 = token.startsWith(V2_PREFIX);
  const combined = base64urlDecode(isV2 ? token.slice(V2_PREFIX.length) : token);
  if (combined.length < CIPHERTEXT_OFFSET + TAG_LENGTH) {
    throw new Error('Invalid share link');
  }
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, CIPHERTEXT_OFFSET);
  const ciphertext = combined.subarray(CIPHERTEXT_OFFSET);
  const key = await deriveKey(password, salt, isV2 ? V2_PBKDF2_ITERATIONS : LEGACY_PBKDF2_ITERATIONS);
  const params = {
    name: 'AES-GCM',
    iv,
    tagLength: TAG_LENGTH * 8,
    ...(isV2 ? { additionalData: V2_ADDITIONAL_DATA } : {}),
  };
  try {
    const decrypted = await crypto.subtle.decrypt(params, key, ciphertext);
    return decodeSharePlaintext(new Uint8Array(decrypted));
  } catch {
    throw new Error('Wrong password or invalid share link');
  }
}

/** Prefix used in the URL hash for share links */
export const SHARE_HASH_PREFIX = 's=';

/**
 * Build the share URL for the current origin.
 */
export function buildShareUrl(token: string): string {
  const base = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname || '/'}`
    : '';
  const hash = `#${SHARE_HASH_PREFIX}${token}`;
  return `${base.replace(/\/$/, '')}${hash}`;
}

/**
 * Parse the encrypted payload from a share URL or hash string.
 * Returns the encrypted token or null.
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
