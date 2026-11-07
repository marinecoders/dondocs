import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cleanup: vi.fn<() => Promise<number | null>>() }));
vi.mock('@/lib/attachmentGc', () => ({ sweepOrphanedAttachments: mocks.cleanup }));
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { idbGetAllDocuments } from '@/lib/documentsDb';

beforeEach(() => { mocks.cleanup.mockReset().mockResolvedValue(0); });
afterEach(async () => { await vi.dynamicImportSettled(); });
async function trashDocument() {
  useDocumentsStore.getState().newDocument();
  const id = useDocumentsStore.getState().currentId!;
  useDocumentStore.getState().setField('subject', 'Cleanup test document');
  useDocumentsStore.getState().saveCurrent();
  await idbGetAllDocuments();
  useDocumentsStore.getState().remove(id);
  await idbGetAllDocuments();
  return id;
}
it('keeps a committed deletion successful when background attachment cleanup fails', async () => {
  const id = await trashDocument();
  mocks.cleanup.mockRejectedValueOnce(new Error('Cleanup unavailable'));
  expect(await useDocumentsStore.getState().permanentlyDelete(id)).toBe(true);
  await vi.dynamicImportSettled();
  expect(mocks.cleanup).toHaveBeenCalledOnce();
  expect((await idbGetAllDocuments())!.some(document => document.id === id)).toBe(false);
});
it('allows independent background cleanup to outlive the document commit', async () => {
  const id = await trashDocument();let finish!: (result: number) => void;
  const cleanup = new Promise<number>(resolve => { finish = resolve; });mocks.cleanup.mockReturnValueOnce(cleanup);
  expect(await useDocumentsStore.getState().permanentlyDelete(id)).toBe(true);
  await vi.dynamicImportSettled();
  expect(mocks.cleanup).toHaveBeenCalledOnce();
  expect((await idbGetAllDocuments())!.some(document => document.id === id)).toBe(false);
  finish(0);await cleanup;
});
