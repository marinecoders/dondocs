import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useDocumentsStore } from '@/stores/documentsStore';
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
afterEach(() => vi.restoreAllMocks());
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
