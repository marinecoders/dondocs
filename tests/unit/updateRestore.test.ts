import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { readUpdateRestore, writeUpdateRestore, clearUpdateRestore, type UpdateRestorePoint } from '@/lib/updateRestore';
import { restoreUpdateCheckpoint, prepareUpdateCheckpoint, registerUpdateGuard } from '@/lib/updateCheckpoint';
import { useDocumentsStore } from '@/stores/documentsStore';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { useBatchStore } from '@/stores/batchStore';
import * as attachments from '@/lib/attachments';
import { runFileImport, isFileImportInProgress } from '@/lib/fileImports';
const point: UpdateRestorePoint = { schema: 1, dataFormat: 1, target: 'new', previous: 'old', documentId: 'original',
  section: null, view: { editorLayout: 'focused', previewVisible: false, sidebarCollapsed: false, sidebarOutlineVisible: false }, scroll: 0 };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); clearUpdateRestore(); useBatchStore.setState({ status: 'idle' }); });

it('restores this tab’s document instead of the shared current document and keeps the point until boot completes', () => {
  useDocumentsStore.setState({ docs: { original: { meta: { id: 'original', title: 'Original', docType: 'naval_letter', updatedAt: 1 }, session: getSerializedSession() } }, currentId: 'other', hydrated: true });
  writeUpdateRestore(point);
  expect(restoreUpdateCheckpoint('new')).toBe(true);
  expect(useDocumentsStore.getState().currentId).toBe('original');
  expect(readUpdateRestore()?.documentId).toBe('original');
  expect(() => restoreUpdateCheckpoint('unexpected')).toThrow('selected update release');
});

it('pauses before checkpointing an active job or a failed operation guard', async () => {
  useBatchStore.setState({ status: 'running' });
  await expect(prepareUpdateCheckpoint('new', 'old')).rejects.toThrow('Finish the current batch');
  expect(readUpdateRestore()).toBeNull();
  useBatchStore.setState({ status: 'idle' });
  const unregister = registerUpdateGuard(() => { throw new Error('Export still running'); });
  await expect(prepareUpdateCheckpoint('new', 'old')).rejects.toThrow('Export still running');
  unregister();
});

it('fails before navigation when the tab cannot store its restore point', () => {
  vi.stubGlobal('sessionStorage', { setItem() { throw new Error('blocked'); } });
  expect(() => writeUpdateRestore(point)).toThrow('blocked');
  vi.unstubAllGlobals();
  expect(readUpdateRestore()).toBeNull();
});

it('checkpoints settings-only drafts and restores their exact document', async () => {
  useDocumentStore.getState().resetForm();
  useDocumentsStore.setState({ currentId: 'fresh-settings', docs: {}, trash: {}, hydrated: true, baseline: getSerializedSession() });
  useDocumentStore.getState().setFormData({ serial: 'REVIEW-123', unitLine1: 'REVIEW UNIT' });
  const saved = await prepareUpdateCheckpoint('new', 'old');
  expect(saved.documentId).toBe('fresh-settings');
  useDocumentsStore.getState().newDocument();
  restoreUpdateCheckpoint('new');
  expect(useDocumentStore.getState().formData).toMatchObject({ serial: 'REVIEW-123', unitLine1: 'REVIEW UNIT' });
});

it('blocks updates during file reads and releases the guard only after applying their result', async () => {
  let finishRead!: () => void, finishApply!: () => void;
  const reading = new Promise<void>(resolve => { finishRead = resolve; });
  const applying = new Promise<void>(resolve => { finishApply = resolve; });
  const importing = runFileImport(async () => { await reading; await applying; });
  try {
    await expect(prepareUpdateCheckpoint('new', 'old')).rejects.toThrow('Finish the current batch, import');
    finishRead(); await Promise.resolve();
    expect(isFileImportInProgress()).toBe(true);
  } finally { finishRead(); finishApply(); await importing; }
  expect(isFileImportInProgress()).toBe(false);
  await expect(runFileImport(async () => { throw new Error('Invalid file'); })).rejects.toThrow('Invalid file');
  expect(isFileImportInProgress()).toBe(false);
});

it('rejects stalled attachment reads at the storage deadline without leaving a restore point', async () => {
  useDocumentStore.getState().resetForm();
  useDocumentsStore.setState({ currentId: 'slow-read', docs: {}, trash: {}, hydrated: true, baseline: getSerializedSession() });
  useDocumentStore.getState().setFormData({ subject: 'SLOW READ' });
  useDocumentStore.setState({ enclosures: [{ title: 'Slow attachment', fileRef: { id: 'slow-read', name: 'proof.pdf', type: 'application/pdf', size: 1 } }] });
  const read = vi.spyOn(attachments, 'loadAttachment').mockReturnValue(new Promise(() => {}));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1; });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const checkpoint = prepareUpdateCheckpoint('new', 'old');
  const rejected = expect(checkpoint).rejects.toThrow('Storage is not responding');
  for (let attempt = 0; attempt < 100 && !read.mock.calls.length; attempt++) await new Promise(resolve => setImmediate(resolve));
  expect(read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(16000);
  await rejected;
  expect(readUpdateRestore()).toBeNull();
});
