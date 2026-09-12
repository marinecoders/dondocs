/**
 * A letter handed over by the local companion in the URL fragment.
 *
 * Distinct from a share link (`shareCrypto.ts`, `#s=`), which leaves the
 * device and is therefore encrypted under a password. This one is written
 * by the companion running on the same machine and read here; the fragment
 * is never sent to a server, so there is nobody to keep it from and no
 * password to ask for. `App.tsx` strips it from the address bar as soon as
 * it is applied, the same way it does an imported share.
 *
 * Format: base64url(DEFLATE(JSON)), the JSON being a `SerializedSession`.
 * The companion writes it with node's zlib, which produces the same stream
 * pako reads here.
 */
import pako from 'pako';
import type { SerializedSession } from '@/stores/documentStore';

/** The fragment a handoff arrives in, as `#d=`. */
export const HANDOFF_HASH_PREFIX = 'd=';

/** The payload from a handoff URL or bare fragment, or null when it is not one. */
export function parseHandoffUrl(urlOrHash: string): string | null {
  if (!urlOrHash) { return null; }
  const hash = urlOrHash.includes('#')
    ? urlOrHash.slice(urlOrHash.indexOf('#'))
    : urlOrHash.startsWith('#') ? urlOrHash : `#${urlOrHash}`;
  return hash.startsWith('#' + HANDOFF_HASH_PREFIX) ? hash.slice(1 + HANDOFF_HASH_PREFIX.length) : null;
}

function base64urlDecode(payload: string): Uint8Array {
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const binary = atob(pad ? base64 + '='.repeat(4 - pad) : base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
  return bytes;
}

/** Whether this really is a session, so a bad payload is refused whole. */
function isSession(value: unknown): value is SerializedSession {
  const s = value as Partial<SerializedSession> | null;
  return !!s && typeof s === 'object'
    && typeof s.docType === 'string'
    && Array.isArray(s.paragraphs)
    && !!s.formData && typeof s.formData === 'object';
}

/**
 * The session a handoff payload carries, or null when it is truncated,
 * misencoded, or not a letter. The caller says so plainly rather than
 * loading half a document.
 */
export function decodeHandoff(payload: string): SerializedSession | null {
  try {
    const json = pako.inflate(base64urlDecode(payload), { to: 'string' });
    const parsed: unknown = JSON.parse(json);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
