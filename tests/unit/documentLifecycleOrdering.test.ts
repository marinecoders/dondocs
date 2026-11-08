import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import * as db from '@/lib/documentsDb';
import { flushDocumentWrites, importLibrary, reconcileDocuments, useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
vi.mock('@/lib/attachmentGc', () => ({ sweepOrphanedAttachments: vi.fn(async () => 0) }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function savedDocument() {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Original');
  useDocumentsStore.getState().saveCurrent(); await flushDocumentWrites();
  return useDocumentsStore.getState().currentId!;
}
afterEach(async () => { vi.restoreAllMocks(); await flushDocumentWrites(); });
it('keeps a document and its history when another tab restores the reviewed Trash revision', async () => {
  const id = await savedDocument();
  useDocumentsStore.getState().remove(id); await flushDocumentWrites();
  const expected = useDocumentsStore.getState().trash[id];
  const { deletedAt: _deleted, ...meta } = expected.meta;
  const restored = { id, meta: { ...meta, updatedAt: meta.updatedAt + 1 }, session: expected.session };
  await db.idbPutDocument(restored); // An older writer does not broadcast or use the queue.
  const history = await db.idbGetSnapshots(id);
  expect(await useDocumentsStore.getState().permanentlyDelete(id)).toBe(false);
  expect((await db.idbGetAllDocuments())!.find(record => record.id === id)).toEqual(restored);
  expect(await db.idbGetSnapshots(id)).toEqual(history);
});
it('excludes a local restore and duplicate delete while permanent deletion is in progress', async () => {
  const id = await savedDocument(); useDocumentsStore.getState().remove(id); await flushDocumentWrites();
  const gate = deferred(); const original = db.idbDeleteDocumentIfUnchanged;
  const deletion = vi.spyOn(db, 'idbDeleteDocumentIfUnchanged').mockImplementationOnce(async expected => { await gate.promise; return original(expected); });
  const pending = useDocumentsStore.getState().permanentlyDelete(id);
  await waitFor(() => expect(deletion).toHaveBeenCalledOnce());
  useDocumentsStore.getState().restoreFromTrash(id);
  expect(useDocumentsStore.getState().docs[id]).toBeUndefined();
  expect(await useDocumentsStore.getState().permanentlyDelete(id)).toBe(false);
  gate.resolve(); expect(await pending).toBe(true);
  expect((await db.idbGetAllDocuments())!.some(record => record.id === id)).toBe(false);
  expect(await db.idbGetSnapshots(id)).toEqual([]);
});
it('removes an unchanged Trash revision refreshed while permanent deletion is pending', async () => {
  const id = await savedDocument();
  useDocumentsStore.getState().remove(id);
  await flushDocumentWrites();
  const records = (await db.idbGetAllDocuments())!;
  const original = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function(this: IDBObjectStore, key) {
    const request = original.call(this, key);
    if (this.name === 'documents' && key === id) reconcileDocuments(structuredClone(records));
    return request;
  });
  expect(await useDocumentsStore.getState().permanentlyDelete(id)).toBe(true);
  expect(useDocumentsStore.getState().trash[id]).toBeUndefined();
  expect((await db.idbGetAllDocuments())!.some(record => record.id === id)).toBe(false);
});
it('rolls back both document and history deletion if the transaction aborts', async () => {
  const id = await savedDocument();
  const expected = (await db.idbGetAllDocuments())!.find(record => record.id === id)!;
  const history = await db.idbGetSnapshots(id);
  const original = IDBObjectStore.prototype.delete;
  const deletion = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function(this: IDBObjectStore, key) {
    const request = original.call(this, key);
    if (this.name === 'documents' && key === id) request.addEventListener('success', () => request.transaction!.abort());
    return request;
  });
  expect(await db.idbDeleteDocumentIfUnchanged(expected)).toBe('failed'); deletion.mockRestore();
  expect((await db.idbGetAllDocuments())!.find(record => record.id === id)).toEqual(expected);
  expect(await db.idbGetSnapshots(id)).toEqual(history);
});
it('preserves a pending edit when a library refresh has the same timestamp', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  const id = await savedDocument();
  const readGate = deferred(), writeGate = deferred();
  const originalRead = db.idbGetAllDocuments, originalWrite = db.idbWriteDocument;
  let reads = 0;
  const read = vi.spyOn(db, 'idbGetAllDocuments').mockImplementation(async () => {
    if (++reads === 2) await readGate.promise;
    return originalRead();
  });
  const write = vi.spyOn(db, 'idbWriteDocument').mockImplementation(async (before, after) => {
    if (after.id === id) await writeGate.promise;
    return originalWrite(before, after);
  });
  const importing = importLibrary(JSON.stringify({ kind: 'dondocs-library', version: 1, docs: [] }));
  try {
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    useDocumentStore.getState().setField('subject', 'Pending edit'); useDocumentsStore.getState().saveCurrent();
    expect(write).toHaveBeenCalledOnce(); readGate.resolve(); await importing;
    expect(useDocumentsStore.getState().docs[id].session.formData.subject).toBe('Pending edit');
  } finally { readGate.resolve(); writeGate.resolve(); await importing; }
  await flushDocumentWrites();
  expect((await originalRead())!.find(record => record.id === id)!.session.formData.subject).toBe('Pending edit');
});
it.each([false, true])('reopens the imported active revision when the refresh read fails: %s', async failedRefresh => {
  const id = await savedDocument();
  const current = (await db.idbGetAllDocuments())!;
  const original = current.find(record => record.id === id)!;
  const imported = {
    ...original,
    meta: { ...original.meta, updatedAt: original.meta.updatedAt + 1 },
    session: { ...original.session, formData: { ...original.session.formData, subject: 'Restored revision' } },
  };
  if (failedRefresh) vi.spyOn(db, 'idbGetAllDocuments').mockResolvedValueOnce(current).mockResolvedValueOnce(null);
  expect(await importLibrary(JSON.stringify({ kind: 'dondocs-library', version: 1, docs: [imported] })))
    .toMatchObject({ imported: 1, skipped: 0 });
  useDocumentsStore.getState().newDocument();
  useDocumentsStore.getState().switchTo(id);
  expect(useDocumentStore.getState().formData.subject).toBe('Restored revision');
});
