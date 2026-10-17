import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore, getSerializedSessionForShare } from '@/stores/documentStore';
import { idbGetAllDocuments, idbPutDocument, idbSetCurrentId } from '@/lib/documentsDb';

it('recovers the identity-bearing pagehide edit before resuming the saved document', async () => {
  useDocumentStore.getState().setFormData({ subject: 'Before reload', serial: '000042' });
  const session = getSerializedSessionForShare();
  const meta = { id: 'reload-doc', title: 'Before reload', docType: session.docType, updatedAt: 1 };
  const original = { id: meta.id, meta, session };
  await idbPutDocument(original);
  await idbSetCurrentId(meta.id);
  useDocumentsStore.setState({ docs: { [meta.id]: { meta, session } }, currentId: meta.id, baseline: session, hydrated: false });
  useDocumentStore.getState().setFormData({ subject: 'Last edit before reload' });
  window.dispatchEvent(new Event('pagehide'));
  const pending = JSON.parse(sessionStorage.getItem('dondocs-pending-writes')!)[0];
  expect(pending.before).toEqual(original);
  expect(pending.versions[0].session.formData.subject).toBe('Last edit before reload');

  // Simulate teardown aborting the asynchronous write while the synchronous
  // recovery record survives in this tab's session storage.
  await idbGetAllDocuments();
  await idbPutDocument(original);
  sessionStorage.setItem('dondocs-pending-writes', JSON.stringify([pending]));
  useDocumentsStore.setState({ docs: {}, currentId: null, baseline: null, hydrated: false });
  await useDocumentsStore.getState().init();
  expect(useDocumentsStore.getState().currentId).toBe(meta.id);
  expect(useDocumentStore.getState().formData.subject).toBe('Last edit before reload');
  expect(useDocumentStore.getState().formData.serial).toBe('000042');
  expect(sessionStorage.getItem('dondocs-interrupted-save')).toBeNull();
});
