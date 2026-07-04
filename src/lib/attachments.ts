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

/**
 * Store `data` under a fresh id and return the reference to persist in the
 * enclosure. On a failed write it still returns a ref (so the in-memory file
 * keeps working this session) — the enclosure just won't survive a reload.
 */
export async function persistAttachment(meta: AttachmentMeta, data: ArrayBuffer): Promise<FileRef> {
  const id = newAttachmentId();
  const rec: StoredAttachment = { id, name: meta.name, type: meta.type, size: meta.size, data };
  await idbPutAttachment(rec);
  return { id, name: meta.name, size: meta.size, type: meta.type };
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
