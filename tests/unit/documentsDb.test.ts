// Sets a real (in-memory) IndexedDB on the global before documentsDb evaluates,
// so its module-load `hasIndexedDb` probe sees a store. Must be the first import.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  isIdbAvailable,
  idbPutDocument,
  idbGetAllDocuments,
  idbDeleteDocument,
  idbGetCurrentId,
  idbSetCurrentId,
  idbAddSnapshot,
  idbGetSnapshots,
  idbDeleteSnapshots,
  type StoredDocument,
} from '@/lib/documentsDb';

// Minimal but structurally-valid stored document. Tests use unique ids so they
// don't depend on a clean DB (the module caches one connection for the run).
const doc = (id: string): StoredDocument =>
  ({
    id,
    meta: { id, title: `Doc ${id}`, docType: 'naval_letter', updatedAt: 1 },
    session: {
      docType: 'naval_letter',
      paragraphs: [],
      references: [],
      enclosures: [],
      copyTos: [],
      distributions: [],
    },
  }) as unknown as StoredDocument;

describe('documentsDb (fake-indexeddb)', () => {
  it('reports IndexedDB available in this environment', () => {
    expect(isIdbAvailable()).toBe(true);
  });

  it('round-trips put → getAll → delete, confirming a committed put with true', async () => {
    expect(await idbPutDocument(doc('rt-1'))).toBe(true);
    const all = await idbGetAllDocuments();
    expect(all.find((d) => d.id === 'rt-1')?.meta.title).toBe('Doc rt-1');

    await idbDeleteDocument('rt-1');
    expect((await idbGetAllDocuments()).find((d) => d.id === 'rt-1')).toBeUndefined();
  });

  it('returns false (never a false-positive true) when the write cannot commit', async () => {
    // A function is not structured-cloneable, so the put fails and the
    // transaction never commits. This is the exact contract the legacy-blob
    // migration relies on — it deletes the source ONLY when put() returns true,
    // so a false here is what prevents data loss on a non-durable write.
    const bad = { id: 'bad-1', meta: {}, session: () => {} } as unknown as StoredDocument;
    expect(await idbPutDocument(bad)).toBe(false);
    expect((await idbGetAllDocuments()).find((d) => d.id === 'bad-1')).toBeUndefined();
  });

  it('round-trips the current-document pointer and clears it with null', async () => {
    expect(await idbSetCurrentId('cur-1')).toBe(true);
    expect(await idbGetCurrentId()).toBe('cur-1');
    expect(await idbSetCurrentId(null)).toBe(true);
    expect(await idbGetCurrentId()).toBeNull();
  });

  it('caps version-history snapshots at the 10 most recent (newest first)', async () => {
    for (let i = 1; i <= 13; i++) {
      await idbAddSnapshot('snap-doc', { ts: i, session: doc('x').session });
    }
    const snaps = await idbGetSnapshots('snap-doc');
    expect(snaps).toHaveLength(10);
    expect(snaps[0].ts).toBe(13); // most recent kept
    expect(snaps[snaps.length - 1].ts).toBe(4); // ts 1–3 dropped by the cap
    await idbDeleteSnapshots('snap-doc');
    expect(await idbGetSnapshots('snap-doc')).toEqual([]);
  });
});
