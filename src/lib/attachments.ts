/**
 * Enclosure attachment persistence.
 *
 * Enclosure file bytes used to live only in memory on the open document, so a
 * reload dropped them (the serialized session kept a bare `hasFile` flag and the
 * user had to re-attach) and a backup could never carry them. This module stores
 * those bytes in the IndexedDB `attachments` store and hands back a small
 * {@link FileRef} the session can persist. On load the bytes are streamed back
 * in; a full backup pulls exactly the blobs its documents reference.
 *
 * Ids are random, not a content hash: `crypto.subtle` (SHA-256) is unavailable
 * on a non-secure origin, which an air-gapped `http://` deployment may well be —
 * and the system never needs the id to be content-derived. `crypto.getRandomValues`
 * has no secure-context requirement, so id generation works everywhere. The
 * trade-off is no cross-enclosure dedup (the same file attached twice is stored
 * twice); acceptable for a handful of enclosures, and a later content-addressed
 * scheme can migrate in without changing the on-disk shape.
 *
 * All local browser operations — no network, air-gap safe.
 */
import type { FileRef } from '@/types/document';
import {
  idbPutAttachment,
  idbGetAttachment,
  idbReadAttachment,
  type AttachmentReadResult,
  idbGetAllAttachments,
  type StoredAttachment,
} from '@/lib/documentsDb';

/** 16 random bytes, hex — collision-free for this scale without needing SubtleCrypto. */
export function newAttachmentId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Last-resort fallback for exotic environments without WebCrypto at all.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `att_${hex}`;
}

export interface AttachmentMeta {
  name: string;
  size: number;
  type: string;
}

let stagingCount = 0;
let stagingGeneration = 0;
const ATTACHMENT_LOCK = 'dondocs-attachment-lifetime';

/** Keep operation-owned blobs alive until they are installed or abandoned. */
export async function withAttachmentStaging<T>(operation: () => Promise<T>): Promise<T> {
  stagingCount++;
  stagingGeneration++;
  try {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return await navigator.locks.request(ATTACHMENT_LOCK, { mode: 'shared' }, operation);
    }
    return await operation();
  } finally { stagingCount--; }
}

/** An exclusive sweep cannot race staging in another tab on the same origin. */
export async function withAttachmentSweep<T>(operation: () => Promise<T>): Promise<T | null> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(ATTACHMENT_LOCK, { mode: 'exclusive', ifAvailable: true }, lock => lock ? operation() : null);
  }
  return operation();
}

/** A sweep's mark set expires even if staging starts and finishes during a read. */
export function attachmentSweepCheckpoint(): number | null {
  return stagingCount ? null : stagingGeneration;
}

/** Return a durable reference only after the operation-owned bytes commit. */
export async function persistAttachment(meta: AttachmentMeta, data: ArrayBuffer, _options: { requireDurable?: true } = {}): Promise<FileRef> {
  const id = newAttachmentId();
  const rec: StoredAttachment = { id, name: meta.name, type: meta.type, size: meta.size, data: data.slice(0) };
  if (!await idbPutAttachment(rec)) throw new Error(`Could not save ${rec.name}. Check browser storage and try again.`);
  return { id, name: rec.name, size: rec.size, type: rec.type };
}

/** Strict readers preserve the distinction between absence and failed storage. */
export function readAttachment(id: string): Promise<AttachmentReadResult> {
  return idbReadAttachment(id);
}

/** Load an attachment's bytes by id; null if missing or unreadable. */
export async function loadAttachment(id: string): Promise<ArrayBuffer | null> {
  const rec = await idbGetAttachment(id);
  return rec?.data ?? null;
}

/** All stored attachments; null when the read failed (distinct from empty). */
export async function loadAllAttachments(): Promise<StoredAttachment[] | null> {
  return idbGetAllAttachments();
}

/** Persist an attachment record verbatim (used by backup restore). */
export async function putAttachmentRecord(rec: StoredAttachment): Promise<boolean> {
  return idbPutAttachment(rec);
}
