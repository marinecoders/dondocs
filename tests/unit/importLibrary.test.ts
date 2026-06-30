import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { idbPutDocument, idbGetAllDocuments, idbDeleteDocument, type StoredDocument } from '@/lib/documentsDb';
import { importLibrary, useDocumentsStore } from '@/stores/documentsStore';

const rec = (id: string, updatedAt: number): StoredDocument =>
  ({
    id,
    meta: { id, title: `T ${id}`, docType: 'naval_letter', updatedAt },
    session: {
      docType: 'naval_letter',
      paragraphs: [],
      references: [],
      enclosures: [],
      copyTos: [],
      distributions: [],
    },
  }) as unknown as StoredDocument;

const libraryJson = (records: unknown[]) => JSON.stringify({ kind: 'dondocs-library', version: 1, docs: records });

async function clearDb() {
  for (const r of await idbGetAllDocuments()) await idbDeleteDocument(r.id);
}

describe('importLibrary — conflict-aware backup restore', () => {
  beforeEach(clearDb);

  it('replaces older-local, skips older-backup, imports new, and drops malformed records', async () => {
    // Local library: A and B both at t=100.
    await idbPutDocument(rec('A', 100));
    await idbPutDocument(rec('B', 100));

    const { imported, skipped } = await importLibrary(
      libraryJson([
        rec('A', 50), // older than local → skipped
        rec('B', 200), // newer than local → replaces
        rec('C', 10), // new id → imported
        { session: {} }, // malformed (no meta.id) → dropped, not counted
      ])
    );

    expect(imported).toBe(2); // B (replace) + C (new)
    expect(skipped).toBe(1); // A (older backup)

    const byId = new Map((await idbGetAllDocuments()).map((r) => [r.id, r.meta.updatedAt]));
    expect(byId.get('A')).toBe(100); // local copy kept — not clobbered by the older backup
    expect(byId.get('B')).toBe(200); // replaced by the newer backup
    expect(byId.get('C')).toBe(10); // brand-new imported
    expect(byId.has('malformed')).toBe(false);

    // The in-memory registry reflects the merge immediately.
    expect(Object.keys(useDocumentsStore.getState().docs).sort()).toEqual(['A', 'B', 'C']);
  });

  it('imports an equal-timestamp backup (>= wins, so a re-import is idempotent, not skipped)', async () => {
    await idbPutDocument(rec('A', 100));
    const { imported, skipped } = await importLibrary(libraryJson([rec('A', 100)]));
    expect(imported).toBe(1);
    expect(skipped).toBe(0);
  });

  it('throws on a file whose docs is missing or not an array', async () => {
    await expect(importLibrary('{}')).rejects.toThrow();
    await expect(importLibrary('{"docs":"nope"}')).rejects.toThrow();
  });
});
