import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { captureDocumentScope, flushDocumentWrites, isCurrentDocumentScope, useDocumentsStore } from '@/stores/documentsStore';
import { getSavedSession, useDocumentStore } from '@/stores/documentStore';
import { STORAGE_KEYS } from '@/lib/constants';
import { idbPutDocument, idbSetCurrentId, idbGetCurrentId, idbGetAllDocuments, idbAddSnapshot, idbGetSnapshots, type StoredDocument } from '@/lib/documentsDb';
const record = (id: string, title = id): StoredDocument => ({ id, meta: { id, title, docType: 'naval_letter', updatedAt: 1 }, session: { documentMode: 'compliant', documentCategory: 'correspondence', formType: 'naval_letter', timestamp: 1, docType: 'naval_letter', formData: { subject: title }, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [] } }) as StoredDocument;
function reviewReset(expected: StoredDocument | null) {
  useDocumentsStore.setState({ currentId: expected?.id ?? null, docs: expected ? { [expected.id]: expected } : {}, trash: {} });
  const boundary = new ErrorBoundary({ children: null });
  vi.spyOn(boundary, 'setState').mockImplementation(() => {});
  boundary.handleResetAndReload();
  return boundary;
}
beforeEach(() => vi.spyOn(window.location, 'reload').mockImplementation(() => {}));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('erases the reviewed document while preserving another tab resume choice', async () => {
  const a = record('reset-a'), b = record('reset-b');
  await idbPutDocument(a); await idbPutDocument(b); await idbSetCurrentId(a.id);
  const boundary = reviewReset(a);
  await idbSetCurrentId(b.id); await boundary.performResetAndReload();
  const saved = await idbGetAllDocuments();
  expect(saved!.find(doc => doc.id === a.id)).toBeUndefined();
  expect(saved!.find(doc => doc.id === b.id)).toEqual(b);
  expect(await idbGetCurrentId()).toBe(b.id);
});
it('keeps a revision changed after reset confirmation opened, including its history', async () => {
  const a = record('reset-changed'); await idbPutDocument(a); await idbSetCurrentId(a.id);
  const boundary = reviewReset(a);
  const newer = record(a.id, 'Other tab edit'); await idbPutDocument(newer);
  await idbAddSnapshot(a.id, { ts: 1, session: newer.session });
  const history = await idbGetSnapshots(a.id);
  await boundary.performResetAndReload();
  expect((await idbGetAllDocuments())!.find(doc => doc.id === a.id)).toEqual(newer);
  expect(await idbGetSnapshots(a.id)).toEqual(history);
  expect(await idbGetCurrentId()).toBeNull();
});
it('does not erase library content when initialization failed before a document was owned', async () => {
  const b = record('reset-unowned'); await idbPutDocument(b); await idbSetCurrentId(b.id);
  const boundary = reviewReset(null); await boundary.performResetAndReload();
  expect((await idbGetAllDocuments())!.find(doc => doc.id === b.id)).toEqual(b);
  expect(await idbGetCurrentId()).toBeNull();
});
it('preserves a newer resume choice made while an unowned reset is awaiting confirmation', async () => {
  const a = record('reset-unowned-before'), b = record('reset-unowned-after');
  await idbPutDocument(a); await idbPutDocument(b); await idbSetCurrentId(a.id);
  const boundary = reviewReset(null);
  await idbSetCurrentId(b.id);
  await boundary.performResetAndReload();
  expect(await idbGetCurrentId()).toBe(b.id);
  const saved = await idbGetAllDocuments();
  expect(saved!.find(doc => doc.id === a.id)).toEqual(a);
  expect(saved!.find(doc => doc.id === b.id)).toEqual(b);
});

async function savedEditor() {
  useDocumentsStore.setState({ currentId: null, docs: {}, trash: {}, baseline: null, hydrated: true });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Crashing document');
  useDocumentsStore.getState().saveCurrent();
  await flushDocumentWrites();
  return useDocumentsStore.getState().currentId!;
}

it('invalidates the erased editor before pagehide or delayed autosave can recreate its session', async () => {
  const id = await savedEditor();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  useDocumentStore.getState().setField('subject', 'Crashing edited document');
  const scope = captureDocumentScope();
  const boundary = new ErrorBoundary({ children: null });
  vi.spyOn(boundary, 'setState').mockImplementation(() => {});
  vi.spyOn(window.location, 'reload').mockImplementation(() => { window.dispatchEvent(new Event('pagehide')); });
  boundary.handleResetAndReload();
  await boundary.performResetAndReload();
  await vi.advanceTimersByTimeAsync(2500);
  expect(isCurrentDocumentScope(scope)).toBe(false);
  expect(getSavedSession()).toBeNull();
  expect((await idbGetAllDocuments())!.some(doc => doc.id === id)).toBe(false);
  expect(await idbGetCurrentId()).toBeNull();
});

it('keeps newer editor changes when reset confirmation becomes stale', async () => {
  const id = await savedEditor();
  const boundary = new ErrorBoundary({ children: null });
  const state = vi.spyOn(boundary, 'setState').mockImplementation(() => {});
  localStorage.setItem(STORAGE_KEYS.DOCUMENT, 'Keep this checkpoint');
  boundary.handleResetAndReload();
  useDocumentStore.getState().setField('subject', 'Changed after confirmation');
  await boundary.performResetAndReload();
  expect(state).toHaveBeenCalledWith({ resetError: 'The document changed while confirmation was open. Cancel and try again.' });
  expect(window.location.reload).not.toHaveBeenCalled();
  expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT)).toBe('Keep this checkpoint');
  expect(useDocumentsStore.getState().currentId).toBe(id);
  expect((await idbGetAllDocuments())!.find(doc => doc.id === id)).toBeDefined();
  await flushDocumentWrites();
});
