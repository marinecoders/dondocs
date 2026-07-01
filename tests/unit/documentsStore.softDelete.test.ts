import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useDocumentsStore } from '@/stores/documentsStore';
import { idbPutDocument, idbGetAllDocuments, idbDeleteDocument } from '@/lib/documentsDb';

const entry = (id: string, updatedAt = 1) => ({
  meta: { id, title: `D ${id}`, docType: 'naval_letter', updatedAt },
  session: {
    docType: 'naval_letter',
    paragraphs: [],
    references: [],
    enclosures: [],
    copyTos: [],
    distributions: [],
  },
});
const tick = () => new Promise((r) => setTimeout(r, 5));

async function clearDb() {
  for (const r of await idbGetAllDocuments()) await idbDeleteDocument(r.id);
}

// Regression guard: previously the IDB record was deleted only by the 6s purge
// timer, so closing/reloading the tab within the undo window left the record
// behind and the "deleted" doc resurrected on next load. The record is now
// removed eagerly; only the in-memory undo copy waits out the timer.
describe('documentsStore soft delete — eager purge closes the resurrection window', () => {
  beforeEach(async () => {
    await clearDb();
    useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null, pendingDelete: null });
  });

  it('removes the IndexedDB record immediately, and undo re-persists it', async () => {
    const d1 = entry('d1');
    const cur = entry('cur');
    await idbPutDocument({ id: 'd1', meta: d1.meta as never, session: d1.session as never });
    await idbPutDocument({ id: 'cur', meta: cur.meta as never, session: cur.session as never });
    useDocumentsStore.setState({ docs: { d1, cur } as never, currentId: 'cur' });

    useDocumentsStore.getState().remove('d1');
    await tick(); // let the fire-and-forget idbDeleteDocument commit

    // Immediately gone from IndexedDB — a reload's idbGetAllDocuments won't see it.
    expect((await idbGetAllDocuments()).find((r) => r.id === 'd1')).toBeUndefined();
    // ...but still undoable from the in-memory copy.
    expect(useDocumentsStore.getState().pendingDelete?.ids).toEqual(['d1']);

    useDocumentsStore.getState().restoreDeleted();
    await tick();

    expect((await idbGetAllDocuments()).find((r) => r.id === 'd1')).toBeDefined();
    expect(useDocumentsStore.getState().docs.d1).toBeDefined();
  });
});
