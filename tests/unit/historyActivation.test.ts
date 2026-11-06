import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSavedSession, useDocumentStore, resumeSessionSaves } from '@/stores/documentStore';
import { changeDocumentHistory, captureDocumentScope, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useFormStore } from '@/stores/formStore';
import { fixtureInstance } from '../_helpers/formFixture';
import { importForm, editForm } from '@/services/forms/documents';
import { idbGetAllDocuments } from '@/lib/documentsDb';

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
