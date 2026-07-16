// Sets a real (in-memory) IndexedDB on the global before documentsDb evaluates.
// Must be the first import.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  idbPutDocument,
  idbDeleteDocument,
  idbGetAllDocuments,
  idbAddSnapshot,
  idbDeleteSnapshots,
  idbPutAttachment,
  idbGetAttachment,
  idbGetAllAttachments,
  idbDeleteAttachment,
  type StoredDocument,
  type StoredAttachment,
} from '@/lib/documentsDb';
import * as documentsDb from '@/lib/documentsDb';
import * as backup from '@/lib/backup';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { sweepOrphanedAttachments, collectLiveAttachmentIds } from '@/lib/attachmentGc';

// A stored document whose single enclosure points at attachment `refId` (or none).
const doc = (id: string, refId?: string): StoredDocument =>
  ({
    id,
    meta: { id, title: `Doc ${id}`, docType: 'naval_letter', updatedAt: 1 },
    session: {
      docType: 'naval_letter',
      paragraphs: [],
      references: [],
      enclosures: refId
        ? [{ title: 'Enc', fileRef: { id: refId, name: 'f.pdf', size: 3, type: 'application/pdf' } }]
        : [],
      copyTos: [],
      distributions: [],
    },
  }) as unknown as StoredDocument;

const att = (id: string): StoredAttachment => ({
  id,
  name: 'f.pdf',
  type: 'application/pdf',
  size: 3,
  data: new Uint8Array([1, 2, 3]).buffer,
});

// Global reads make the sweep sensitive to leftovers; start every test clean.
async function clearAll() {
  const docs = (await idbGetAllDocuments()) ?? [];
  for (const d of docs) {
    await idbDeleteSnapshots(d.id);
    await idbDeleteDocument(d.id);
  }
  const atts = (await idbGetAllAttachments()) ?? [];
  for (const a of atts) await idbDeleteAttachment(a.id);
  useDocumentStore.setState({ enclosures: [] });
  useDocumentsStore.setState({ docs: {} });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await clearAll();
});

describe('sweepOrphanedAttachments', () => {
  it('deletes an unreferenced blob and keeps a referenced one', async () => {
    await idbPutDocument(doc('d1', 'att_keep'));
    await idbPutAttachment(att('att_keep'));
    await idbPutAttachment(att('att_orphan')); // no document points at this

    const deleted = await sweepOrphanedAttachments();

    expect(deleted).toBe(1);
    expect(await idbGetAttachment('att_keep')).toBeTruthy();
    expect(await idbGetAttachment('att_orphan')).toBeNull();
  });

  it('KEEPS a blob referenced only by a version-history snapshot (undo must survive)', async () => {
    // The live doc no longer references att_snap, but an earlier snapshot does.
    await idbPutDocument(doc('d2')); // current session: no enclosures
    await idbAddSnapshot('d2', { ts: 1, session: doc('d2', 'att_snap').session });
    await idbPutAttachment(att('att_snap'));

    const deleted = await sweepOrphanedAttachments();

    expect(deleted).toBe(0);
    expect(await idbGetAttachment('att_snap')).toBeTruthy();
  });

  it('KEEPS a blob referenced only by the in-memory registry (unpersisted local save / duplicate)', async () => {
    // A doc the in-memory registry knows about but whose IndexedDB write hasn't
    // landed — this is what buildBackup marks from, so the sweep must not reap it.
    useDocumentsStore.setState({
      docs: {
        m1: {
          meta: { id: 'm1', title: 'In memory', docType: 'naval_letter', updatedAt: 1 },
          session: doc('m1', 'att_inmem').session,
        },
      },
    } as never);
    await idbPutAttachment(att('att_inmem')); // blob on disk, doc only in memory

    const deleted = await sweepOrphanedAttachments();

    expect(deleted).toBe(0);
    expect(await idbGetAttachment('att_inmem')).toBeTruthy();
  });

  it('KEEPS a blob a duplicate still shares after the original is deleted', async () => {
    // duplicateDocument shares the same session object → same fileRef id. Deleting
    // one copy must NOT free the blob the other still points at (mark-and-sweep
    // keeps anything referenced by anyone; eager per-doc deletion would corrupt).
    await idbPutDocument(doc('keeper', 'att_dup'));
    await idbPutAttachment(att('att_dup'));
    // ('deleted-copy' is already gone; only the keeper references att_dup.)

    const deleted = await sweepOrphanedAttachments();

    expect(deleted).toBe(0);
    expect(await idbGetAttachment('att_dup')).toBeTruthy();
  });

  it('KEEPS a blob referenced only by the live in-memory session (unsynced attach)', async () => {
    // No persisted doc references it yet — it was just attached this session.
    useDocumentStore.setState({
      enclosures: [{ title: 'Fresh', fileRef: { id: 'att_live', name: 'f.pdf', size: 3, type: '' } }],
    } as never);
    await idbPutAttachment(att('att_live'));

    const deleted = await sweepOrphanedAttachments();

    expect(deleted).toBe(0);
    expect(await idbGetAttachment('att_live')).toBeTruthy();
  });

  it("KEEPS a just-uploaded basic letter referenced only by the live session's formData", async () => {
    // The endorsement's basic letter lives in formData.basicLetterFileRef, not
    // enclosures. Root (c) once passed only { enclosures } to the collector, so
    // a sweep in the ~2s before the debounced save (e.g. finalizePurge after a
    // document delete) reaped a letter the user had just uploaded.
    useDocumentStore.setState((state) => ({
      enclosures: [],
      formData: {
        ...state.formData,
        basicLetterFileRef: { id: 'att_letter', name: 'letter.pdf', size: 3, type: 'application/pdf' },
      },
    }) as never);
    await idbPutAttachment(att('att_letter'));

    const deleted = await sweepOrphanedAttachments();

    expect(deleted).toBe(0);
    expect(await idbGetAttachment('att_letter')).toBeTruthy();
  });

  it('ABORTS and deletes nothing when the document registry is unreadable', async () => {
    // A read FAILURE (null) must not be read as "no docs reference anything".
    vi.spyOn(documentsDb, 'idbGetAllDocuments').mockResolvedValue(null);
    await idbPutAttachment(att('att_x'));

    const result = await sweepOrphanedAttachments();

    expect(result).toBeNull();
    expect(await idbGetAttachment('att_x')).toBeTruthy();
  });

  it('ABORTS when the attachment store is unreadable', async () => {
    await idbPutDocument(doc('d3', 'att_ref'));
    vi.spyOn(documentsDb, 'idbGetAllAttachments').mockResolvedValue(null);

    const result = await sweepOrphanedAttachments();

    expect(result).toBeNull();
  });

  it('stands down entirely while a backup restore is in flight', async () => {
    vi.spyOn(backup, 'isRestoreInProgress').mockReturnValue(true);
    await idbPutAttachment(att('att_during_restore')); // an orphan, but restore is running

    const result = await sweepOrphanedAttachments();

    expect(result).toBeNull();
    expect(await idbGetAttachment('att_during_restore')).toBeTruthy();
  });

  it('no-ops on an all-referenced store', async () => {
    await idbPutDocument(doc('d4', 'att_a'));
    await idbPutDocument(doc('d5', 'att_b'));
    await idbPutAttachment(att('att_a'));
    await idbPutAttachment(att('att_b'));

    const deleted = await sweepOrphanedAttachments();

    expect(deleted).toBe(0);
    expect(await idbGetAttachment('att_a')).toBeTruthy();
    expect(await idbGetAttachment('att_b')).toBeTruthy();
  });
});

// Integration: the soft-delete undo window must not lose attachments. remove()
// hard-deletes the document record from IDB immediately but keeps an in-memory
// undo copy for 6s; a sweep firing in that window must still see the doc's
// attachment (via the pending-delete mark-set source) so an undo restores a
// document whose enclosure bytes are intact.
describe('soft-delete undo window keeps attachments reachable', () => {
  beforeEach(async () => {
    await clearAll();
    useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null, pendingDelete: null });
  });

  it('a pending-delete doc still protects its attachment; undo leaves it intact', async () => {
    // A doc referencing att_pending, plus a separate current doc so remove()
    // doesn't trigger the reopen-fallback path.
    const target = {
      meta: { id: 'target', title: 'Target', docType: 'naval_letter', updatedAt: 1 },
      session: doc('target', 'att_pending').session,
    };
    const keeper = { meta: { id: 'keeper', title: 'Keeper', docType: 'naval_letter', updatedAt: 2 }, session: doc('keeper').session };
    await idbPutDocument(target as never);
    await idbPutAttachment(att('att_pending'));
    useDocumentsStore.setState({ docs: { target, keeper } as never, currentId: 'keeper' });

    // Soft-delete: the IDB record and the in-memory entry are gone, held only in
    // the pending-undo buffer.
    useDocumentsStore.getState().remove('target');
    await new Promise((r) => setTimeout(r, 5)); // let the eager idbDeleteDocument commit
    expect((await idbGetAllDocuments())?.find((r) => r.id === 'target')).toBeUndefined();
    expect(useDocumentsStore.getState().docs.target).toBeUndefined();

    // The mark set STILL includes att_pending (via the pending-delete source),
    // so a sweep in the undo window does not reap it.
    const live = await collectLiveAttachmentIds();
    expect(live?.has('att_pending')).toBe(true);
    expect(await sweepOrphanedAttachments()).toBe(0);
    expect(await idbGetAttachment('att_pending')).toBeTruthy();

    // Undo re-lists the doc and cancels the purge timer (no dangling 6s sweep).
    useDocumentsStore.getState().restoreDeleted();
    await new Promise((r) => setTimeout(r, 5));
    expect(useDocumentsStore.getState().docs.target).toBeDefined();
    expect(await idbGetAttachment('att_pending')).toBeTruthy();
  });
});
