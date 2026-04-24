/**
 * Compressed localStorage helpers.
 *
 * Session documents are highly repetitive JSON — the same field names,
 * template placeholders, and LaTeX snippets appear many times. pako.deflate
 * (already in the bundle for enclosure PDF handling) compresses a typical
 * session 3–5× before base64, netting ~2–3× after the base64 expansion. That
 * buys headroom against the per-origin localStorage cap (5–10 MB in most
 * browsers) and shrinks the write size for the debounced session saves that
 * fire on every edit.
 *
 * Forward/backward compatibility:
 *   - Compressed writes are prefixed with "gz:" so we can detect them on
 *     read. Legacy (plain-JSON) values written before this change still
 *     parse via the no-prefix path, so users never see their session
 *     disappear after upgrade.
 *   - If compression somehow produces a larger string than the input (e.g.
 *     a tiny payload where the deflate header dominates), we fall back to
 *     writing plain JSON. Read path handles both shapes regardless.
 */

import pako from 'pako';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { debug } from './debug';

const COMPRESSED_PREFIX = 'gz:';

/**
 * Serialize an object for localStorage, compressing with DEFLATE + base64.
 * Returns a string that can be round-tripped through compressedParse.
 *
 * Falls back to plain JSON if the compressed form is larger than the plain
 * form (very small payloads), so we never pay a size penalty.
 */
export function compressedStringify(value: unknown): string {
  const json = JSON.stringify(value);
  try {
    const deflated = pako.deflate(json);
    const encoded = COMPRESSED_PREFIX + uint8ArrayToBase64(deflated);
    // Only use compressed form if it's actually smaller. For tiny objects
    // the deflate+base64 overhead can outweigh the compression gain.
    return encoded.length < json.length ? encoded : json;
  } catch (err) {
    debug.warn('compressedStorage', 'Deflate failed, falling back to plain JSON', err);
    return json;
  }
}

/**
 * Parse a value produced by compressedStringify OR by a plain JSON.stringify
 * call (for backward compatibility with sessions written before compression
 * was enabled).
 */
export function compressedParse<T = unknown>(serialized: string): T {
  if (serialized.startsWith(COMPRESSED_PREFIX)) {
    const base64 = serialized.slice(COMPRESSED_PREFIX.length);
    const bytes = base64ToUint8Array(base64);
    const inflated = pako.inflate(bytes);
    const json = new TextDecoder().decode(inflated);
    return JSON.parse(json) as T;
  }
  return JSON.parse(serialized) as T;
}
