import 'fake-indexeddb/auto';
import { waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as db from '@/lib/documentsDb';
import { useDocumentsStore, exportLibrary } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
});
afterEach(() => vi.restoreAllMocks());
describe('truthful save feedback', () => {
  it('includes an edit made immediately before a backup', async () => {
    useDocumentStore.getState().setField('subject', 'Last-second change');
    const backup = JSON.parse(await exportLibrary());
    expect(backup.docs[0].session.formData.subject).toBe('Last-second change');
  });
  it('does not mark newer edits saved when an earlier write finishes', async () => {
    let finish!: (value: db.DocumentWriteOutcome) => void;
    vi.spyOn(db, 'idbWriteDocument').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    useDocumentStore.getState().setField('subject', 'First edit');
    expect(useUIStore.getState().saveStatus).toBe('pending');
    useDocumentsStore.getState().saveCurrent();
    expect(useUIStore.getState().saveStatus).toBe('saving');
    useDocumentStore.getState().setField('subject', 'Second edit');
    finish('committed');
    await Promise.resolve();
    expect(useUIStore.getState().saveStatus).toBe('pending');
  });
  it('shows failure when browser storage is unavailable', async () => {
    vi.spyOn(db, 'idbWriteDocument').mockResolvedValue('failed');
    useDocumentsStore.getState().saveCurrent();
    await waitFor(() => expect(useUIStore.getState().saveStatus).toBe('error'));
  });
});
