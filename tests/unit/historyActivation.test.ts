import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadSharedSession, replaceSessionState, getSavedSession, getSerializedSession, rehydrateEnclosureFiles, mutateSessionAssets, useDocumentStore, resumeSessionSaves } from '@/stores/documentStore';
import { changeDocumentHistory, captureDocumentScope, flushDocumentWrites, isCurrentDocumentScope, openSessionAsNew, useDocumentsStore } from '@/stores/documentsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useFormStore } from '@/stores/formStore';
import { fixtureInstance } from '../_helpers/formFixture';
import { importForm, editForm } from '@/services/forms/documents';
import { idbGetAllDocuments } from '@/lib/documentsDb';
import { loadAttachment, persistAttachment } from '@/lib/attachments';
import { sweepOrphanedAttachments } from '@/lib/attachmentGc';
import { parseDraftFile } from '@/lib/draftFile';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resumeSessionSaves();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
});
afterEach(async () => { await flushDocumentWrites(); vi.clearAllTimers(); vi.useRealTimers(); });

it('rejects an old history request before touching either stack or editor', async () => {
  const documents = useDocumentsStore.getState();
  useDocumentStore.getState().setField('subject', 'A');
  await vi.advanceTimersByTimeAsync(500);
  documents.saveCurrent();
  const a = useDocumentsStore.getState().currentId!;
  const old = captureDocumentScope();
  documents.newDocument();
  useDocumentStore.getState().setField('subject', 'B');
  documents.switchTo(a);
  useDocumentStore.getState().setField('subject', 'Later A');
  await vi.advanceTimersByTimeAsync(500);
  const before = useHistoryStore.getState();
  expect(changeDocumentHistory('undo', old)).toBe('stale');
  expect(useHistoryStore.getState().past).toBe(before.past);
  expect(useHistoryStore.getState().future).toBe(before.future);
  expect(useDocumentStore.getState().formData.subject).toBe('Later A');
});

it('keeps delayed recovery, registry writes and history with their activation', async () => {
  const documents = useDocumentsStore.getState();
  useDocumentStore.getState().setField('subject', 'Latest A');
  const a = useDocumentsStore.getState().currentId!;
  await vi.advanceTimersByTimeAsync(250);
  documents.newDocument();
  const b = useDocumentsStore.getState().currentId!;
  useDocumentStore.getState().setField('subject', 'Latest B');
  await vi.advanceTimersByTimeAsync(2500);
  await flushDocumentWrites();
  const stored = await idbGetAllDocuments();
  expect(stored!.find(record => record.id === a)!.session.formData.subject).toBe('Latest A');
  expect(stored!.find(record => record.id === b)!.session.formData.subject).toBe('Latest B');
  expect(getSavedSession()!.formData.subject).toBe('Latest B');
  expect(useHistoryStore.getState().currentSnapshot!.formData.subject).toBe('Latest B');
  expect(useHistoryStore.getState().past.every(snapshot => snapshot.formData.subject !== 'Latest A')).toBe(true);
});

it('ignores cancelled timer callbacks from the first A activation', async () => {
  const documents = useDocumentsStore.getState();
  useDocumentStore.getState().setField('subject', 'A');
  documents.saveCurrent();
  const a = useDocumentsStore.getState().currentId!;
  const timeout = vi.spyOn(globalThis, 'setTimeout');
  useDocumentStore.getState().setField('subject', 'Outgoing A');
  const callbacks = timeout.mock.calls.filter(([, delay]) => [500, 1500, 2000].includes(Number(delay))).map(([callback]) => callback);
  expect(callbacks).toHaveLength(3);
  timeout.mockRestore();
  documents.newDocument();
  useDocumentStore.getState().setField('subject', 'B');
  documents.switchTo(a);
  useDocumentStore.getState().setField('subject', 'Later A');
  const history = useHistoryStore.getState();
  localStorage.setItem('dondocs-document-session', JSON.stringify({ marker: 'unchanged recovery' }));
  for (const callback of callbacks) if (typeof callback === 'function') callback();
  expect(useHistoryStore.getState().currentSnapshot).toBe(history.currentSnapshot);
  expect(localStorage.getItem('dondocs-document-session')).toContain('unchanged recovery');
  // Stale callbacks must not clear the replacement activation's pending flush.
  window.dispatchEvent(new Event('pagehide'));
  expect(getSavedSession()!.formData.subject).toBe('Later A');
  await flushDocumentWrites();
  expect((await idbGetAllDocuments())!.find(record => record.id === a)!.session.formData.subject).toBe('Later A');
});

it('captures a pending edit before Undo and preserves Redo', () => {
  useDocumentStore.getState().setField('subject', 'First edit');
  const scope = captureDocumentScope();
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).not.toBe('First edit');
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('First edit');
});

it('preserves Redo when a legacy signature receives its durable handle', async () => {
  useDocumentStore.getState().setFormData({ signatureType: 'image', signatureImage: { name: 'legacy.png', size: 3, data: 'YWJj' } });
  await vi.advanceTimersByTimeAsync(500);
  useDocumentStore.getState().setField('subject', 'After');
  await vi.advanceTimersByTimeAsync(500);
  const scope = captureDocumentScope();
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  await rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  const ref = useDocumentStore.getState().formData.signatureImage?.fileRef;
  expect(ref).toBeDefined();
  const history = useHistoryStore.getState();
  expect(history.currentSnapshot!.formData.signatureImage).toEqual({ name: 'legacy.png', size: 3, data: 'YWJj', fileRef: ref });
  expect(history.future[0].formData.signatureImage?.fileRef).toEqual(ref);
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('After');
});

it('keeps same-name legacy signature replacements distinct during history migration', async () => {
  const scope = captureDocumentScope();
  const apply = (data: string) => useDocumentStore.getState().setFormData({ signatureType: 'image', signatureImage: { name: 'same.png', size: 3, data } });
  apply('YWJj');
  await vi.advanceTimersByTimeAsync(500);
  apply('ZGVm');
  await vi.advanceTimersByTimeAsync(500);
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  await rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  expect(useDocumentStore.getState().formData.signatureImage?.data).toBe('YWJj');
  expect(useHistoryStore.getState().future[0].formData.signatureImage).toEqual({ name: 'same.png', size: 3, data: 'ZGVm' });
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  await rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  expect(useDocumentStore.getState().formData.signatureImage?.data).toBe('ZGVm');
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  await rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  expect(useDocumentStore.getState().formData.signatureImage?.data).toBe('YWJj');
});

it('rejects a foreign history entry without changing the stacks', async () => {
  useDocumentStore.getState().setField('subject', 'A');
  await vi.advanceTimersByTimeAsync(500);
  const foreign = useHistoryStore.getState().currentSnapshot!;
  useDocumentsStore.getState().newDocument();
  useHistoryStore.setState({ past: [foreign] });
  const history = useHistoryStore.getState();
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('stale');
  expect(useHistoryStore.getState().past).toBe(history.past);
  expect(useHistoryStore.getState().currentSnapshot).toBe(history.currentSnapshot);
});

it.each(['navmc_10274', 'navmc_118_11'] as const)('retains values, options and Undo while navigating %s', async kind => {
  const documents = useDocumentsStore.getState();
  documents.newDocument(kind);
  const id = useDocumentsStore.getState().currentId!;
  if (kind === 'navmc_10274') useFormStore.getState().setNavmc10274Field('natureOfAction', 'Original form');
  else useFormStore.getState().setNavmc11811Field('remarksTextRight', 'Original form');
  useFormStore.getState().setIncludeCoverPage(true);
  await vi.advanceTimersByTimeAsync(500);
  if (kind === 'navmc_10274') useFormStore.getState().setNavmc10274Field('natureOfAction', 'Latest form');
  else useFormStore.getState().setNavmc11811Field('remarksTextRight', 'Latest form');
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
  expect(useFormStore.getState().includeCoverPage).toBe(true);
  documents.newDocument();
  useDocumentStore.getState().setField('subject', 'Letter');
  documents.switchTo(id);
  expect(kind === 'navmc_10274' ? useFormStore.getState().navmc10274.natureOfAction : useFormStore.getState().navmc11811.remarksTextRight).toBe('Original form');
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('unchanged');
  await vi.advanceTimersByTimeAsync(2500);
  await flushDocumentWrites();
  expect((await idbGetAllDocuments())!.find(record => record.id === id)!.session.forms!.includeCoverPage).toBe(true);
});

it('preserves generic form repeated rows in history and storage', async () => {
  importForm(fixtureInstance());
  const id = useDocumentsStore.getState().currentId!;
  const previous = structuredClone(useDocumentStore.getState().genericForm!.rows);
  editForm(draft => { draft.rows.roster = [{ id: 'latest-row', answers: { grade: 'e2' } }]; });
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
  expect(useDocumentStore.getState().genericForm!.rows).toEqual(previous);
  expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');
  await vi.advanceTimersByTimeAsync(2500);
  await flushDocumentWrites();
  expect((await idbGetAllDocuments())!.find(record => record.id === id)!.session.genericForm!.rows.roster[0].id).toBe('latest-row');
});

it('keeps an ordinary in-document type change undoable within one owner', async () => {
  const scope = captureDocumentScope();
  const previous = useDocumentStore.getState().docType;
  useDocumentStore.getState().setDocType('business_letter');
  await vi.advanceTimersByTimeAsync(500);
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  expect(useDocumentStore.getState().docType).toBe(previous);
});

it.each(['enclosure', 'basic-letter'] as const)('preserves Redo after hydrating a saved %s', async kind => {
  const ref = await persistAttachment({ name: 'attached.pdf', size: 1, type: 'application/pdf' }, new Uint8Array([1]).buffer);
  const session = { ...getSerializedSession(), formData: { subject: 'Before', ...(kind === 'basic-letter' ? { basicLetterFileRef: ref } : {}) },
    enclosures: kind === 'enclosure' ? [{ title: 'Attachment', fileRef: ref }] : [],
  };
  openSessionAsNew(session);
  const openingScope = captureDocumentScope();
  await rehydrateEnclosureFiles(() => isCurrentDocumentScope(openingScope));
  useDocumentStore.getState().setField('subject', 'After');
  await vi.advanceTimersByTimeAsync(500);
  const scope = captureDocumentScope();
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('Before');
  await vi.advanceTimersByTimeAsync(500);
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('After');
});

it('preserves Redo when a transient upload receives its durable handle', async () => {
  const file = { name: 'attached.pdf', size: 1, data: new Uint8Array([1]).buffer };
  useDocumentStore.setState({ enclosures: [{ title: 'Attachment', file }] });
  await vi.advanceTimersByTimeAsync(500);
  useDocumentStore.getState().setField('subject', 'After');
  await vi.advanceTimersByTimeAsync(500);
  const scope = captureDocumentScope();
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  const ref = await persistAttachment({ name: file.name, size: file.size, type: 'application/pdf' }, file.data);
  mutateSessionAssets(() => useDocumentStore.getState().updateEnclosure(0, { fileRef: ref }));
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('After');
});

it.each(['enclosure', 'basic-letter'] as const)('keeps same-name, same-size transient %s replacements undoable', async kind => {
  const file = (value: number) => ({ name: 'same.pdf', size: 1, data: new Uint8Array([value]).buffer });
  const first = file(1); const second = file(2);
  const apply = (upload: typeof first) => {
    if (kind === 'enclosure') useDocumentStore.setState({ enclosures: [{ title: 'Attachment', file: upload }] });
    else useDocumentStore.getState().setField('basicLetterFile', upload);
  };
  apply(first);
  await vi.advanceTimersByTimeAsync(500);
  apply(second);
  const scope = captureDocumentScope();
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  expect(kind === 'enclosure' ? useDocumentStore.getState().enclosures[0].file!.data : useDocumentStore.getState().formData.basicLetterFile!.data).toBe(first.data);
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  expect(kind === 'enclosure' ? useDocumentStore.getState().enclosures[0].file!.data : useDocumentStore.getState().formData.basicLetterFile!.data).toBe(second.data);
});

it('restores the older enclosure bytes instead of reusing a same-title replacement', async () => {
  const oldBytes = new Uint8Array([1]).buffer; const newBytes = new Uint8Array([2]).buffer;
  const meta = { name: 'same.pdf', size: 1, type: 'application/pdf' };
  const oldRef = await persistAttachment(meta, oldBytes); const newRef = await persistAttachment(meta, newBytes);
  openSessionAsNew({ ...getSerializedSession(), enclosures: [{ title: 'Same attachment', fileRef: oldRef }] });
  const scope = captureDocumentScope();
  await rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  useDocumentStore.getState().updateEnclosure(0, { fileRef: newRef, file: { name: meta.name, size: 1, data: newBytes } });
  await vi.advanceTimersByTimeAsync(500);
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  await rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  const restored = useDocumentStore.getState().enclosures[0];
  expect(restored.fileRef!.id).toBe(oldRef.id);
  expect(new Uint8Array(restored.file!.data)[0]).toBe(1);
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  expect(new Uint8Array(useDocumentStore.getState().enclosures[0].file!.data)[0]).toBe(2);
});

it.each(['past', 'future'] as const)('keeps attachment blobs reachable from only the %s Undo stack', async stack => {
  useDocumentStore.getState().setField('subject', 'History assets');
  useDocumentsStore.getState().saveCurrent();
  const bytes = new Uint8Array([7]).buffer;
  const ref = await persistAttachment({ name: 'undo-only.pdf', size: 1, type: 'application/pdf' }, bytes);
  useDocumentStore.getState().addEnclosure('Undo only', { name: ref.name, size: 1, data: bytes }, ref);
  await vi.advanceTimersByTimeAsync(500);
  if (stack === 'past') {
    useDocumentStore.getState().removeEnclosure(0);
    await vi.advanceTimersByTimeAsync(500);
  } else expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
  useDocumentsStore.getState().saveCurrent();
  await flushDocumentWrites();
  await sweepOrphanedAttachments();
  expect(await loadAttachment(ref.id)).not.toBeNull();
  expect(changeDocumentHistory(stack === 'past' ? 'undo' : 'redo', captureDocumentScope())).toBe('applied');
  expect(useDocumentStore.getState().enclosures[0].fileRef!.id).toBe(ref.id);
  await flushDocumentWrites();
  expect(await loadAttachment(ref.id)).not.toBeNull();
});

it('preserves the current history when a reviewed draft fails normalization', async () => {
  useDocumentStore.getState().setField('subject', 'Existing edit');
  await vi.advanceTimersByTimeAsync(500);
  const scope = captureDocumentScope();
  const history = useHistoryStore.getState();
  const session = getSerializedSession();
  const reviewed = parseDraftFile({ ...session, formData: { ...session.formData, manualFrontMatter: 123 } });

  expect(() => loadSharedSession(reviewed.session)).toThrow();
  expect(captureDocumentScope()).toEqual(scope);
  expect(useHistoryStore.getState().past).toBe(history.past);
  expect(useHistoryStore.getState().currentSnapshot).toBe(history.currentSnapshot);
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('Existing edit');

  useDocumentStore.getState().setField('subject', 'Next edit');
  await vi.advanceTimersByTimeAsync(500);
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('Existing edit');
});

it('settles history ownership when a replacement callback fails after changing the editor', async () => {
  const failure = new Error('Replacement failed');
  expect(() => replaceSessionState(() => {
    useDocumentStore.getState().setField('subject', 'Partially applied');
    throw failure;
  })).toThrow(failure);

  useDocumentStore.getState().setField('subject', 'Next edit');
  await vi.advanceTimersByTimeAsync(500);
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('Partially applied');
  expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('Next edit');
});
