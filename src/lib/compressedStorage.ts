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
import type { StateStorage } from 'zustand/middleware';
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

/**
 * Zustand `StateStorage` adapter that transparently compresses values via
 * DEFLATE + base64 before they reach localStorage. Drop-in replacement for
 * the default `localStorage` argument to `createJSONStorage`.
 *
 * The compression path is identical to `compressedStringify`/`compressedParse`
 * (same `gz:` prefix, same plain-JSON fallback for tiny payloads), but it
 * operates on the already-stringified JSON that Zustand's persist middleware
 * hands to `setItem`. That keeps the wire format consistent across all
 * compressed-storage call sites: a value written by `compressedStringify`
 * round-trips through this adapter's `getItem` and vice versa.
 *
 * Backward-compat: legacy `dondocs_*` keys written as plain JSON before this
 * adapter shipped are still readable -- the absence of the `gz:` prefix
 * routes them through the plain-text branch in `getItem`, so users never see
 * their persisted profiles / UI prefs disappear on upgrade. The first
 * subsequent write rewrites them in compressed form.
 */
export const compressedLocalStorage: StateStorage = {
  getItem: (name) => {
    const value = localStorage.getItem(name);
    if (value === null) return null;
    if (!value.startsWith(COMPRESSED_PREFIX)) return value;
    try {
      const bytes = base64ToUint8Array(value.slice(COMPRESSED_PREFIX.length));
      const decoded = new TextDecoder().decode(pako.inflate(bytes));
      // A truncated/empty `gz:` payload (e.g. `"gz:"` alone, written by a
      // bug or manual tampering) inflates to "" without throwing. Returning
      // "" would crash Zustand's downstream `JSON.parse(...)`; treat it the
      // same as corrupt so the store falls back to its initial state.
      return decoded || null;
    } catch (err) {
      // A corrupt compressed payload should not silently log out the user's
      // profiles / preferences. Surface it via debug logging and return null
      // so Zustand falls back to its initial state instead of throwing.
      debug.warn('compressedStorage', `Inflate failed for "${name}", returning null`, err);
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const deflated = pako.deflate(value);
      const encoded = COMPRESSED_PREFIX + uint8ArrayToBase64(deflated);
      // Tiny payloads (e.g. uiStore's ~150-byte partialized prefs) compress
      // *larger* than they started thanks to the deflate header + base64
      // expansion. Keep plain JSON in those cases so we never pay a size tax.
      localStorage.setItem(name, encoded.length < value.length ? encoded : value);
    } catch (err) {
      debug.warn('compressedStorage', `Deflate failed for "${name}", writing plain JSON`, err);
      localStorage.setItem(name, value);
    }
  },
  removeItem: (name) => {
    localStorage.removeItem(name);
  },
};
