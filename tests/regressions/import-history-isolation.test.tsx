import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ShareModal } from '@/components/modals/ShareModal';
import { decryptSharePayload } from '@/lib/shareCrypto';
import { applyParsedLetter } from '@/lib/importLetter';
import { idbGetAllDocuments } from '@/lib/documentsDb';
import { getSerializedSessionForShare, suspendSessionSaves, useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useProfileStore } from '@/stores/profileStore';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/lib/shareCrypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/shareCrypto')>(),
  decryptSharePayload: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  suspendSessionSaves();
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useUIStore.setState({ storageHealth: 'ok' });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true, lastKindIds: {} });
  useDocumentsStore.getState().newDocument();
});

afterEach(async () => {
  await flushDocumentWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function originalDocument(): Promise<string> {
  useDocumentStore.getState().setFormData({ subject: 'ORIGINAL DOCUMENT' });
  await vi.advanceTimersByTimeAsync(500);
  useDocumentsStore.getState().saveCurrent();
  await flushDocumentWrites();
  const id = useDocumentsStore.getState().currentId!;
  useDocumentStore.getState().setFormData({ subject: 'LATEST ORIGINAL EDIT' });
  await vi.advanceTimersByTimeAsync(500);
  return id;
}

async function storedSubject(id: string): Promise<string | undefined> {
  return (await idbGetAllDocuments())?.find((record) => record.id === id)?.session.formData.subject;
}

function importLetter(): void {
  applyParsedLetter({
    subject: 'IMPORTED LETTER',
    paragraphs: [{ text: 'Imported body.', level: 0 }],
    references: [], enclosures: [], copyTos: [],
  });
}

describe('new documents do not inherit another document’s Undo history', () => {
  it.each(['undo', 'redo'] as const)('does not persist old content into an imported letter through %s', async (action) => {
    const originalId = await originalDocument();
    if (action === 'redo') {
      useDocumentStore.getState().applySnapshot(useHistoryStore.getState().undo()!);
    }
    const originalSubject = useDocumentStore.getState().formData.subject;
    importLetter();
    const importedId = useDocumentsStore.getState().currentId!;
    expect(importedId).not.toBe(originalId);

    const snapshot = useHistoryStore.getState()[action]();
    if (snapshot) useDocumentStore.getState().applySnapshot(snapshot);
    await vi.advanceTimersByTimeAsync(2500);
    await flushDocumentWrites();

    expect(await storedSubject(originalId)).toBe(originalSubject);
    expect(await storedSubject(importedId)).toBe('IMPORTED LETTER');
    expect(snapshot).toBeNull();
  });

  it('allows Undo within the imported letter without reaching the original document', async () => {
    await originalDocument();
    importLetter();
    await vi.advanceTimersByTimeAsync(500);
    useDocumentStore.getState().setFormData({ subject: 'EDITED IMPORT' });
    await vi.advanceTimersByTimeAsync(500);

    const snapshot = useHistoryStore.getState().undo();
    expect(snapshot?.formData.subject).toBe('IMPORTED LETTER');
    useDocumentStore.getState().applySnapshot(snapshot!);
    expect(useHistoryStore.getState().undo()).toBeNull();
  });

  it('keeps pending history captures inside the newly opened letter', async () => {
    const originalId = await originalDocument();
    useDocumentStore.getState().setFormData({ subject: 'PENDING ORIGINAL EDIT' });
    await vi.advanceTimersByTimeAsync(250);
    importLetter();
    const importedId = useDocumentsStore.getState().currentId!;
    await vi.advanceTimersByTimeAsync(2500);
    await flushDocumentWrites();

    expect(useHistoryStore.getState().currentSnapshot?.formData.subject).toBe('IMPORTED LETTER');
    expect(useHistoryStore.getState().undo()).toBeNull();
    expect(await storedSubject(originalId)).toBe('PENDING ORIGINAL EDIT');
    expect(await storedSubject(importedId)).toBe('IMPORTED LETTER');
  });

  it('preserves the current saved draft when opening a share through the real modal', async () => {
    const originalId = await originalDocument();
    const incoming = getSerializedSessionForShare();
    incoming.formData = { ...incoming.formData, subject: 'SHARED DOCUMENT' };
    vi.mocked(decryptSharePayload).mockResolvedValue(incoming);
    render(<ShareModal open mode="import" initialPayload="SHARED_PAYLOAD" onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Decrypt and review' })); });
    expect(useDocumentsStore.getState().currentId).toBe(originalId);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open as new document' })); });
    const sharedId = useDocumentsStore.getState().currentId!;
    expect(sharedId).not.toBe(originalId);
    expect(useHistoryStore.getState().undo()).toBeNull();
    useDocumentStore.getState().setFormData({ subject: 'EDITED SHARE' });
    await vi.advanceTimersByTimeAsync(2500);
    await flushDocumentWrites();

    expect(await storedSubject(originalId)).toBe('LATEST ORIGINAL EDIT');
    expect(await storedSubject(sharedId)).toBe('EDITED SHARE');
  });

  it('keeps ordinary document switches isolated after pending edits', async () => {
    const originalId = await originalDocument();
    useDocumentsStore.getState().newDocument();
    useDocumentStore.getState().setFormData({ subject: 'SECOND DOCUMENT' });
    await vi.advanceTimersByTimeAsync(500);
    await flushDocumentWrites();
    const secondId = useDocumentsStore.getState().currentId!;
    useDocumentStore.getState().setFormData({ subject: 'PENDING SECOND EDIT' });
    useDocumentsStore.getState().switchTo(originalId);
    await vi.advanceTimersByTimeAsync(2500);
    await flushDocumentWrites();

    expect(useHistoryStore.getState().undo()).toBeNull();
    expect(await storedSubject(originalId)).toBe('LATEST ORIGINAL EDIT');
    expect(await storedSubject(secondId)).toBe('PENDING SECOND EDIT');
  });
});
