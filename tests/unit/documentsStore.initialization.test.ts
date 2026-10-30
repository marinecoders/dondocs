import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { idbGetAllDocuments, idbPutDocument, idbSetCurrentId } from '@/lib/documentsDb';

it('an update flush during hydration cannot save the blank editor over the resumed document', async () => {
  useDocumentStore.getState().setField('subject', 'EDIT JUST BEFORE UPGRADE');
  const session = getSerializedSession();
  session.enclosures = [{ title: 'Proof', hasFile: true, fileRef: { id: 'proof', name: 'proof.pdf', type: 'application/pdf', size: 5 } }];
  const record = { id: 'saved', meta: { id: 'saved', title: 'Saved', docType: 'naval_letter', updatedAt: 1 }, session };
  await idbPutDocument(record);
  await idbSetCurrentId(record.id);
  useDocumentStore.getState().resetForm();
  useDocumentsStore.setState({ hydrated: false, docs: {}, currentId: null, baseline: null });

  let flushing: Promise<void> | undefined;
  const unsubscribe = useDocumentsStore.subscribe(state => {
    // Hydration has published the record and its ID, but init has not loaded
    // its content into the editor. A service-worker callback can run here.
    if (state.hydrated && !flushing) {
      unsubscribe();
      flushing = flushDocumentWrites();
      useDocumentsStore.getState().syncCurrent(); // pagehide uses this path too
    }
  });
  try {
    expect(await useDocumentsStore.getState().init()).toBe(true);
    await flushing;
    expect(useDocumentStore.getState().formData.subject).toBe('EDIT JUST BEFORE UPGRADE');
    expect(await idbGetAllDocuments()).toEqual([record]);
  } finally { unsubscribe(); }
});
