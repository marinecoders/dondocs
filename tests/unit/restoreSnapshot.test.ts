import { describe, it, expect, vi } from 'vitest';

// restoreSnapshot's contract: the safety snapshot of the current draft must
// COMMIT before anything is overwritten — the Version History modal promises a
// restore is reversible, and that snapshot is what makes it true.
const addSnapshotMock = vi.fn();
vi.mock('@/lib/documentsDb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/documentsDb')>();
  return {
    ...actual,
    idbAddSnapshot: (...args: unknown[]) => addSnapshotMock(...args),
  };
});

import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore, type SerializedSession } from '@/stores/documentStore';

const snapshotSession = {
  docType: 'naval_letter',
  documentCategory: 'correspondence',
  formData: { subject: 'THE OLD VERSION' },
  paragraphs: [{ text: 'old body', level: 0 }],
  references: [],
  enclosures: [],
  copyTos: [],
  distributions: [],
} as unknown as SerializedSession;

describe('restoreSnapshot — reversibility is a precondition, not a hope', () => {
  it('restores nothing and resolves false when the safety snapshot cannot be written', async () => {
    addSnapshotMock.mockResolvedValue(false);
    useDocumentsStore.setState({ currentId: 'doc-1', hydrated: true });
    useDocumentStore.getState().setField('subject', 'CURRENT DRAFT');

    await expect(useDocumentsStore.getState().restoreSnapshot(snapshotSession)).resolves.toBe(false);
    // The live editor must be untouched — the restore was refused, not half-applied.
    expect(useDocumentStore.getState().formData.subject).toBe('CURRENT DRAFT');
  });

  it('proceeds once the safety snapshot commits', async () => {
    addSnapshotMock.mockResolvedValue(true);
    useDocumentsStore.setState({ currentId: 'doc-1', hydrated: true });

    await expect(useDocumentsStore.getState().restoreSnapshot(snapshotSession)).resolves.toBe(true);
    expect(useDocumentStore.getState().formData.subject).toBe('THE OLD VERSION');
    // The safety copy was requested for the current doc before the overwrite.
    expect(addSnapshotMock).toHaveBeenCalledWith('doc-1', expect.objectContaining({ session: expect.anything() }));
  });
});
