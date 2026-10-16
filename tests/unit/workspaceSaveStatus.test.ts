import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as db from '@/lib/documentsDb';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
});
afterEach(() => vi.restoreAllMocks());
describe('truthful save feedback', () => {
  it('does not mark newer edits saved when an earlier write finishes', async () => {
    let finish!: (value: boolean) => void;
    vi.spyOn(db, 'idbPutDocument').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    useDocumentStore.getState().setField('subject', 'First edit');
    expect(useUIStore.getState().saveStatus).toBe('pending');
    useDocumentsStore.getState().saveCurrent();
    expect(useUIStore.getState().saveStatus).toBe('saving');
    useDocumentStore.getState().setField('subject', 'Second edit');
    finish(true);
    await Promise.resolve();
    expect(useUIStore.getState().saveStatus).toBe('pending');
  });
  it('shows failure when browser storage is unavailable', () => {
    vi.spyOn(db, 'isIdbAvailable').mockReturnValue(false);
    useDocumentsStore.getState().saveCurrent();
    expect(useUIStore.getState().saveStatus).toBe('error');
  });
});
