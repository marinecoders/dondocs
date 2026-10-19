import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileDocuments, useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Shared tab draft');
  useDocumentsStore.getState().saveCurrent();
});
describe('deletion in another tab', () => {
  it('moves an unchanged open draft out of the editor when it enters Trash', () => {
    const id = useDocumentsStore.getState().currentId!;
    const entry = useDocumentsStore.getState().docs[id];
    reconcileDocuments([{ id, meta: { ...entry.meta, deletedAt: Date.now() }, session: entry.session }]);
    expect(useDocumentsStore.getState().currentId).not.toBe(id);
    expect(useDocumentsStore.getState().docs[id]).toBeUndefined();
    expect(useDocumentsStore.getState().trash[id]).toBeDefined();
  });
  it('preserves newer local edits under a fresh id after permanent deletion', () => {
    const id = useDocumentsStore.getState().currentId!;
    useDocumentStore.getState().setField('subject', 'Newer local work');
    reconcileDocuments([], id);
    const state = useDocumentsStore.getState();
    expect(state.currentId).not.toBe(id);
    expect(state.docs[id]).toBeUndefined();
    expect(state.docs[state.currentId!].session.formData.subject).toBe('Newer local work');
  });
});
