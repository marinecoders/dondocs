import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSerializedSession, mutateSessionAssets, persistUnsavedEnclosures, rehydrateEnclosureFiles, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, isCurrentDocumentScope, changeDocumentHistory, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { persistAttachment } from '@/lib/attachments';

function ownsCurrentDocument() {
  const owner = captureDocumentScope();
  return () => isCurrentDocumentScope(owner);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
});
afterEach(async () => {
  await flushDocumentWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('retains an imported enclosure handle when Undo returns to its pre-persistence snapshot', async () => {
  const file = { name: 'imported.pdf', size: 1, data: new Uint8Array([1]).buffer };
  useDocumentStore.setState({ enclosures: [{ title: 'Imported enclosure', file }] });
  // Opening a draft creates its initial history entry before inline files are persisted.
  useDocumentsStore.getState().openLoadedAsNew();
  const id = useDocumentsStore.getState().currentId!;
  await persistUnsavedEnclosures(ownsCurrentDocument());
  const ref = useDocumentStore.getState().enclosures[0].fileRef!;
  expect(ref).toBeDefined();
  useDocumentStore.getState().setField('subject', 'First edit');
  await vi.advanceTimersByTimeAsync(500);
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
  expect(useDocumentStore.getState().enclosures[0].fileRef).toEqual(ref);
  useDocumentsStore.getState().saveCurrent();
  useDocumentsStore.getState().newDocument();
  useDocumentsStore.getState().switchTo(id);
  await rehydrateEnclosureFiles(ownsCurrentDocument());
  expect(useDocumentStore.getState().enclosures[0].file?.data).toEqual(file.data);
  expect(getSerializedSession().enclosures[0].fileRef).toEqual(ref);
});

it.each(['enclosure', 'basic-letter'] as const)('promotes handles in every %s history stack without clearing Redo', async kind => {
  const file = { name: 'imported.pdf', size: 1, data: new Uint8Array([1]).buffer };
  if (kind === 'enclosure') useDocumentStore.setState({ enclosures: [{ title: 'Imported enclosure', file }] });
  else useDocumentStore.getState().setField('basicLetterFile', file);
  await vi.advanceTimersByTimeAsync(500);
  useDocumentStore.getState().setField('subject', 'First edit');
  await vi.advanceTimersByTimeAsync(500);
  useDocumentStore.getState().setField('subject', 'Second edit');
  await vi.advanceTimersByTimeAsync(500);
  const scope = captureDocumentScope();
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  const before = useHistoryStore.getState();
  const ref = await persistAttachment({ name: file.name, size: file.size, type: 'application/pdf' }, file.data);
  mutateSessionAssets(() => {
    if (kind === 'enclosure') useDocumentStore.getState().updateEnclosure(0, { fileRef: ref });
    else useDocumentStore.getState().setField('basicLetterFileRef', ref);
  });
  const history = useHistoryStore.getState();
  expect(history.past).toHaveLength(before.past.length);
  expect(history.future).toHaveLength(before.future.length);
  for (const entry of [...history.past, history.currentSnapshot!, ...history.future]) {
    if (kind === 'enclosure' && entry.enclosures[0]?.file) expect(entry.enclosures[0].fileRef).toEqual(ref);
    if (kind === 'basic-letter' && entry.formData.basicLetterFile) expect(entry.formData.basicLetterFileRef).toEqual(ref);
  }
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('Second edit');
  expect(kind === 'enclosure' ? getSerializedSession().enclosures[0].fileRef : getSerializedSession().formData.basicLetterFileRef).toEqual(ref);
});

it('does not promote a same-name replacement handle onto different bytes', async () => {
  const file = (value: number) => ({ name: 'same.pdf', size: 1, data: new Uint8Array([value]).buffer });
  const first = file(1);
  useDocumentStore.setState({ enclosures: [{ title: 'Attachment', file: first }] });
  await vi.advanceTimersByTimeAsync(500);
  const second = file(2);
  useDocumentStore.setState({ enclosures: [{ title: 'Attachment', file: second }] });
  await vi.advanceTimersByTimeAsync(500);
  await persistUnsavedEnclosures(ownsCurrentDocument());
  const ref = useDocumentStore.getState().enclosures[0].fileRef;
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
  expect(useDocumentStore.getState().enclosures[0].file?.data).toBe(first.data);
  expect(useDocumentStore.getState().enclosures[0].fileRef).toBeUndefined();
  expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');
  expect(useDocumentStore.getState().enclosures[0].fileRef).toEqual(ref);
});
