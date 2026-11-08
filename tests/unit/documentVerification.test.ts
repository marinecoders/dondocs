import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  commitCurrentDocument, flushDocumentWrites, importLibrary, openExistingDocument,
  openRecoveredCopies, reconcileDocuments, useDocumentsStore,
} from '@/stores/documentsStore';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import * as db from '@/lib/documentsDb';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
});
afterEach(() => vi.restoreAllMocks());

async function loadedRecord(id: string) {
  useDocumentStore.getState().setField('subject', 'Untouched document');
  const session = getSerializedSession();
  const meta = { id, title: 'Untouched document', docType: session.docType, updatedAt: 42 };
  const record = { id, meta, session };
  expect(await db.idbPutDocument(record)).toBe(true);
  useDocumentsStore.setState({ docs: { [id]: { meta, session } } });
  return record;
}

function deferVerification() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const write = db.idbWriteDocument;
  vi.spyOn(db, 'idbWriteDocument').mockImplementationOnce(async (before, after) => {
    await gate;
    return write(before, after);
  });
  return release;
}

it('follows another tab’s deletion without rescuing a verification-only write', async () => {
  const record = await loadedRecord('verification-delete');
  const release = deferVerification();
  try {
    expect(openExistingDocument(record.id)).toBe('applied');
    const removed = { ...record, meta: { ...record.meta, deletedAt: Date.now() } };
    expect(await db.idbPutDocument(removed)).toBe(true);
    reconcileDocuments((await db.idbGetAllDocuments())!);
    expect(useDocumentsStore.getState().docs).toEqual({});
    expect(useDocumentsStore.getState().trash[record.id]).toEqual({ meta: removed.meta, session: removed.session });
  } finally { release(); }
  await flushDocumentWrites();
  expect(useDocumentsStore.getState().recoveryCount).toBe(0);
  expect((await db.idbGetAllDocuments())!.find(item => item.id === record.id)?.meta.deletedAt).toBeDefined();
});

it('keeps a failed verification out of recovery and unrelated update saves', async () => {
  const record = await loadedRecord('verification-conflict');
  const release = deferVerification();
  try {
    expect(openExistingDocument(record.id)).toBe('applied');
    const remote = { ...record, session: { ...record.session, formData: { ...record.session.formData, subject: 'Other tab latest version' } } };
    expect(await db.idbPutDocument(remote)).toBe(true);
  } finally { release(); }
  await expect(flushDocumentWrites()).rejects.toThrow('could not be saved');
  expect(useUIStore.getState().saveStatus).toBe('error');
  expect(useDocumentsStore.getState().recoveryCount).toBe(0);
  await expect(commitCurrentDocument()).rejects.toThrow('could not be saved');
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Independent document');
  const receipt = await commitCurrentDocument();
  expect(receipt).not.toBeNull();
  await flushDocumentWrites();
  const saved = (await db.idbGetAllDocuments())!;
  expect(saved.find(item => item.id === record.id)?.session.formData.subject).toBe('Other tab latest version');
  expect(saved.find(item => item.id === receipt!.revision.documentId)?.session.formData.subject).toBe('Independent document');
  expect(useDocumentsStore.getState().recoveryCount).toBe(0);
});

it('retains genuine edits queued behind a verification when another tab changes the record', async () => {
  const record = await loadedRecord('verification-local-edit');
  const release = deferVerification();
  try {
    expect(openExistingDocument(record.id)).toBe('applied');
    useDocumentStore.getState().setField('subject', 'Local unsaved edit');
    useDocumentsStore.getState().syncCurrent();
    expect(await db.idbPutDocument({ ...record, session: { ...record.session, formData: { ...record.session.formData, subject: 'Other tab edit' } } })).toBe(true);
  } finally { release(); }
  await expect(flushDocumentWrites()).rejects.toThrow('could not be saved');
  expect(useDocumentsStore.getState().recoveryCount).toBe(1);
  await openRecoveredCopies();
  await flushDocumentWrites();
  expect(useDocumentStore.getState().formData.subject).toBe('Local unsaved edit');
  expect(useDocumentsStore.getState().currentId).not.toBe(record.id);
  expect((await db.idbGetAllDocuments())!.find(item => item.id === record.id)?.session.formData.subject).toBe('Other tab edit');
  expect(useDocumentsStore.getState().recoveryCount).toBe(0);
});

it('imports a newer backup while an untouched document is being verified', async () => {
  const record = await loadedRecord('verification-backup');
  const release = deferVerification();
  try {
    expect(openExistingDocument(record.id)).toBe('applied');
    const backup = { ...record, meta: { ...record.meta, updatedAt: 43 }, session: { ...record.session, formData: { ...record.session.formData, subject: 'Newer backup revision' } } };
    expect(await importLibrary(JSON.stringify({ docs: [backup] }))).toEqual({ imported: 1, skipped: 0 });
    expect(useUIStore.getState().saveStatus).toBe('pending');
    expect((await db.idbGetAllDocuments())!.find(item => item.id === record.id)?.session.formData.subject).toBe('Newer backup revision');
    await expect(flushDocumentWrites()).rejects.toThrow('open document differs from the saved version');
  } finally { release(); }
  // Keep the existing live editor until the user chooses the imported record.
  useDocumentsStore.getState().newDocument();
  useDocumentsStore.getState().switchTo(record.id);
  await flushDocumentWrites();
  expect(useDocumentStore.getState().formData.subject).toBe('Newer backup revision');
  expect(useUIStore.getState().saveStatus).toBe('saved');
  expect(useDocumentsStore.getState().recoveryCount).toBe(0);
});
