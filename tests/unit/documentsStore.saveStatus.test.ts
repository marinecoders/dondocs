import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore, getSerializedSessionForShare } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { idbPutDocument } from '@/lib/documentsDb';
it('restores the committed status when an edit is reverted before autosave', async () => {
  useDocumentStore.getState().setFormData({ subject: 'Saved' });
  const session = getSerializedSessionForShare();
  const meta = { id: 'status', title: 'Saved', docType: session.docType, updatedAt: 42 };
  await idbPutDocument({ id: meta.id, meta, session });
  useDocumentsStore.setState({ currentId: meta.id, docs: { status: { meta, session } }, baseline: session, hydrated: true });
  useDocumentStore.getState().setFormData({ subject: 'Temporary edit' });
  useDocumentStore.getState().setFormData({ subject: 'Saved' });
  expect(useUIStore.getState().saveStatus).toBe('saving');
  useDocumentsStore.getState().syncCurrent();
  expect(useUIStore.getState().saveStatus).toBe('saved');
  expect(useUIStore.getState().lastSavedAt).toBe(42);
});
