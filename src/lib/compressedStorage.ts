/**
 * Compressed localStorage helpers. Session JSON is highly repetitive, so
 * pako.deflate + base64 nets ~2-3x and buys headroom against the per-origin cap.
 *
 * Compressed writes are prefixed "gz:" so reads can detect them; legacy plain-JSON
 * values still parse via the no-prefix path. Tiny payloads that compress larger
 * than the input fall back to plain JSON; the read path handles both.
 */

import pako from 'pako';
import type { StateStorage } from 'zustand/middleware';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { debug } from './debug';

const COMPRESSED_PREFIX = 'gz:';

/**
 * Serialize an object for localStorage with DEFLATE + base64, round-trippable
 * through compressedParse. Falls back to plain JSON when that's smaller.
 */
export function compressedStringify(value: unknown): string {
  const json = JSON.stringify(value);
  try {
    const deflated = pako.deflate(json);
    const encoded = COMPRESSED_PREFIX + uint8ArrayToBase64(deflated);
    // Use the compressed form only when it's actually smaller.
    return encoded.length < json.length ? encoded : json;
  } catch (err) {
    debug.warn('compressedStorage', 'Deflate failed, falling back to plain JSON', err);
    return json;
  }
}

/**
 * Parse a value produced by compressedStringify or by a plain JSON.stringify
 * (for backward compatibility with pre-compression sessions).
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
 * Zustand StateStorage adapter that compresses values with DEFLATE + base64
 * before localStorage. Drop-in replacement for the default localStorage arg to
 * createJSONStorage. Same wire format as compressedStringify/compressedParse
 * (gz: prefix, plain-JSON fallback), so values round-trip between the two.
 *
 * Legacy plain-JSON `dondocs_*` keys still read through the no-prefix branch and
 * are rewritten compressed on the next write.
 */
export const compressedLocalStorage: StateStorage = {
  getItem: (name) => {
    const value = localStorage.getItem(name);
    if (value === null) return null;
    if (!value.startsWith(COMPRESSED_PREFIX)) return value;
    try {
      const bytes = base64ToUint8Array(value.slice(COMPRESSED_PREFIX.length));
      const decoded = new TextDecoder().decode(pako.inflate(bytes));
      // A truncated/empty `gz:` payload inflates to "" without throwing, which
      // would crash Zustand's downstream JSON.parse. Treat it as corrupt so the
      // store falls back to its initial state.
      return decoded || null;
    } catch (err) {
      // Corrupt payload: Zustand must fall back to the store's initial state
      // (returning null) rather than crash — but the very next persist write
      // would then permanently overwrite the only copy of the user's data. Stash
      // the raw value under a sibling key first so it stays recoverable, and log
      // at error level (warn is verbosity-gated) so the reset is never invisible.
      try {
        localStorage.setItem(`${name}.corrupt`, value);
      } catch {
        /* stash is best-effort — never block the fallback */
      }
      debug.error(
        'compressedStorage',
        `Inflate failed for "${name}" — store reset to defaults; raw payload kept at "${name}.corrupt"`,
        err
      );
      return null;
    }
  },
  setItem: (name, value) => {
    // Compression failure and write failure are handled separately: a write
    // failure is almost always QuotaExceededError, and retrying it with the
    // larger plain value just throws again. Compute the bytes first, then do one
    // guarded write that rethrows so callers can warn the user.
    let toWrite: string;
    try {
      const deflated = pako.deflate(value);
      const encoded = COMPRESSED_PREFIX + uint8ArrayToBase64(deflated);
      // Tiny payloads compress larger than they started; keep plain JSON.
      toWrite = encoded.length < value.length ? encoded : value;
    } catch (err) {
      debug.warn('compressedStorage', `Deflate failed for "${name}", writing plain JSON`, err);
      toWrite = value;
    }
    try {
      localStorage.setItem(name, toWrite);
    } catch (err) {
      // Quota/security error: don't retry with a larger payload. Surface it so
      // the calling action can tell the user storage is full.
      debug.error('compressedStorage', `localStorage write failed for "${name}" (likely quota)`, err);
      throw err;
    }
  },
  removeItem: (name) => {
    localStorage.removeItem(name);
  },
};

// Swallowing write errors is this adapter's contract — but anything that CLAIMS
// durability on top of it (the forms "Saved" indicator) must be able to ask
// whether the latest write for its store actually landed. Tracked per persist key.
const failedWrites = new Set<string>();

/** Did the most recent safeLocalStorage write for this persist key fail? */
export function lastWriteFailed(name: string): boolean {
  return failedWrites.has(name);
}

/**
 * Plain (uncompressed) localStorage adapter that never throws. get/set/remove
 * swallow SecurityError (blocked site data) and quota errors so a persisted
 * store's set() can't escape and crash the app at boot. For small prefs that
 * don't need compression (uiStore, onboardingStore); zustand's default storage
 * does NOT guard writes, which is the crash this prevents. Write outcomes are
 * recorded so durability claims can be checked via lastWriteFailed().
 */
export const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
      failedWrites.delete(name);
    } catch (err) {
      failedWrites.add(name);
      debug.error('safeLocalStorage', `write failed for "${name}" (blocked or full)`, err);
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};
