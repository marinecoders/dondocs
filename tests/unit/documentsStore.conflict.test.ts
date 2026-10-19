import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { useDocumentsStore, flushDocumentWrites, reconcileDocuments, exportLibrary, openRecoveredCopies } from '@/stores/documentsStore';
import { useDocumentStore, getSerializedSessionForShare } from '@/stores/documentStore';
import { idbGetAllDocuments, idbPutDocument } from '@/lib/documentsDb';

it('preserves both versions in backups and opens the latest conflict as a separate copy', async () => {
  useDocumentStore.getState().setFormData({ subject: 'Original' });
  const session = getSerializedSessionForShare();
  const meta = { id: 'conflict', title: 'Original', docType: session.docType, updatedAt: 1 };
  await idbPutDocument({ id: meta.id, meta, session });
  useDocumentsStore.setState({ docs: { conflict: { meta, session } }, currentId: 'conflict', baseline: session, hydrated: true });
  const rival = { ...session, formData: { ...session.formData, subject: 'Other tab' } };
  await idbPutDocument({ id: meta.id, meta: { ...meta, title: 'Other tab', updatedAt: 2 }, session: rival });
  reconcileDocuments((await idbGetAllDocuments())!);
  expect(useDocumentsStore.getState().docs.conflict.session.formData.subject).toBe('Original');
  useDocumentStore.getState().setFormData({ subject: 'This tab' });
  await expect(flushDocumentWrites()).rejects.toThrow('could not be saved');
  const before = JSON.parse(await exportLibrary());
  expect(before.docs.map((doc: { session: typeof session }) => doc.session.formData.subject).sort()).toEqual(['Other tab', 'This tab']);
  // The user continues typing after the conflict was first reported.
  useDocumentStore.getState().setFormData({ subject: 'Latest local edit' });
  await openRecoveredCopies();
  expect(useDocumentStore.getState().formData.subject).toBe('Latest local edit');
  expect(useDocumentsStore.getState().currentId).not.toBe('conflict');
  const saved = (await idbGetAllDocuments())!;
  expect(saved.find(doc => doc.id === 'conflict')?.session.formData.subject).toBe('Other tab');
  expect(saved.find(doc => doc.id !== 'conflict')?.session.formData.subject).toBe('Latest local edit');
  expect(useDocumentsStore.getState().docs.conflict.session.formData.subject).toBe('Other tab');
  expect(useDocumentsStore.getState().recoveryCount).toBe(0);
});
