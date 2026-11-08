import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { idbAddSnapshot, idbGetAllDocuments } from '@/lib/documentsDb';
import { useFormStore } from '@/stores/formStore';

vi.mock('@/lib/documentsDb', async (original) => ({
  ...await original<typeof import('@/lib/documentsDb')>(),
  idbAddSnapshot: vi.fn(async () => true),
}));
const addSnapshot = vi.mocked(idbAddSnapshot);
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  addSnapshot.mockReset().mockResolvedValue(true);
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Current A');
  useDocumentsStore.getState().saveCurrent();
});
afterEach(async () => { await flushDocumentWrites(); vi.clearAllTimers(); vi.useRealTimers(); });

it('does not restore into a later activation of the same document', async () => {
  const documents = useDocumentsStore.getState();
  const a = documents.currentId!;
  const incoming = { ...getSerializedSession(), formData: { subject: 'Old A' } };
  const pending = deferred(); addSnapshot.mockReturnValueOnce(pending.promise);
  const restore = documents.restoreSnapshot(incoming, captureDocumentTarget());
  documents.newDocument();
  useDocumentStore.getState().setField('subject', 'Document B');
  documents.switchTo(a);
  pending.resolve(true);
  expect(await restore).toBe('stale');
  expect(useDocumentStore.getState().formData.subject).toBe('Current A');
  await vi.advanceTimersByTimeAsync(2500);
  await flushDocumentWrites();
  expect((await idbGetAllDocuments())!.find(record => record.id === a)!.session.formData.subject).toBe('Current A');
});

it.each(['letter', 'form'] as const)('retains %s edits made during the safety copy', async kind => {
  const documents = useDocumentsStore.getState();
  if (kind === 'form') documents.newDocument('navmc_118_11');
  const incoming = getSerializedSession();
  const pending = deferred(); addSnapshot.mockReturnValueOnce(pending.promise);
  const restore = documents.restoreSnapshot(incoming, captureDocumentTarget());
  if (kind === 'letter') useDocumentStore.getState().setField('subject', 'Newer edit');
  else useFormStore.getState().setNavmc11811Field('remarksTextRight', 'Newer edit');
  pending.resolve(true);
  expect(await restore).toBe('stale');
  expect(kind === 'letter' ? useDocumentStore.getState().formData.subject : useFormStore.getState().navmc11811.remarksTextRight).toBe('Newer edit');
});

it('allows only the latest overlapping restore to replace content', async () => {
  const documents = useDocumentsStore.getState();
  const session = getSerializedSession();
  const first = deferred(); const second = deferred();
  addSnapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const older = documents.restoreSnapshot({ ...session, formData: { subject: 'Older request' } }, captureDocumentTarget());
  const newer = documents.restoreSnapshot({ ...session, formData: { subject: 'Newer request' } }, captureDocumentTarget());
  first.resolve(true); await older;
  expect(useDocumentStore.getState().formData.subject).toBe('Current A');
  second.resolve(true); await newer;
  expect(useDocumentStore.getState().formData.subject).toBe('Newer request');
});

it('cancels after an edit followed by Undo returns to the original content', async () => {
  const session = getSerializedSession();
  const pending = deferred(); addSnapshot.mockReturnValueOnce(pending.promise);
  const restore = useDocumentsStore.getState().restoreSnapshot(session, captureDocumentTarget());
  useDocumentStore.getState().setField('subject', 'Temporary edit');
  useDocumentStore.getState().setField('subject', 'Current A');
  pending.resolve(true);
  expect(await restore).toBe('stale');
});

it('cancels when the active built-in form cover-page option changes', async () => {
  useDocumentsStore.getState().newDocument('navmc_10274');
  const session = getSerializedSession();
  const pending = deferred(); addSnapshot.mockReturnValueOnce(pending.promise);
  const restore = useDocumentsStore.getState().restoreSnapshot(session, captureDocumentTarget());
  useFormStore.getState().setIncludeCoverPage(!session.forms!.includeCoverPage);
  pending.resolve(true);
  expect(await restore).toBe('stale');
  expect(useFormStore.getState().includeCoverPage).toBe(!session.forms!.includeCoverPage);
});

it.each(['answers', 'rows'] as const)('cancels when generic form %s change', async field => {
  const { fixtureInstance } = await import('../_helpers/formFixture');
  const { importForm, editForm } = await import('@/services/forms/documents');
  importForm(fixtureInstance());
  const pending = deferred(); addSnapshot.mockReturnValueOnce(pending.promise);
  const restore = useDocumentsStore.getState().restoreSnapshot(getSerializedSession(), captureDocumentTarget());
  editForm(draft => {
    if (field === 'answers') draft.answers.name = 'Newer answer';
    else draft.rows.roster = [{ id: 'new', answers: { grade: 'e2' } }];
  });
  pending.resolve(true);
  expect(await restore).toBe('stale');
  const form = useDocumentStore.getState().genericForm!;
  expect(field === 'answers' ? form.answers.name : form.rows.roster[0].id).toBe(field === 'answers' ? 'Newer answer' : 'new');
});

it('keeps an ordinary switch to the already active document in the same scope', async () => {
  const documents = useDocumentsStore.getState();
  const scope = captureDocumentTarget();
  const incoming = { ...getSerializedSession(), formData: { subject: 'Restored' } };
  const pending = deferred(); addSnapshot.mockReturnValueOnce(pending.promise);
  const restore = documents.restoreSnapshot(incoming, scope);
  documents.switchTo(documents.currentId!);
  pending.resolve(true);
  expect(await restore).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('Restored');
});

it('owns the incoming data while awaiting the safety copy', async () => {
  const incoming = { ...getSerializedSession(), formData: { subject: 'Selected version' } };
  const pending = deferred(); addSnapshot.mockReturnValueOnce(pending.promise);
  const restore = useDocumentsStore.getState().restoreSnapshot(incoming, captureDocumentTarget());
  incoming.formData.subject = 'Mutated caller input';
  pending.resolve(true);
  expect(await restore).toBe('applied');
  expect(useDocumentStore.getState().formData.subject).toBe('Selected version');
});

it.each(['enclosure', 'basic-letter'] as const)('counts a new transient %s upload as an intervening edit', async kind => {
  const file = (value: number) => ({ name: 'same.pdf', size: 1, data: new Uint8Array([value]).buffer });
  if (kind === 'enclosure') useDocumentStore.setState({ enclosures: [{ title: 'Upload', file: file(1) }] });
  else useDocumentStore.getState().setFormData({ basicLetterFile: file(1) });
  const pending = deferred(); addSnapshot.mockReturnValueOnce(pending.promise);
  const restore = useDocumentsStore.getState().restoreSnapshot(getSerializedSession(), captureDocumentTarget());
  if (kind === 'enclosure') useDocumentStore.setState({ enclosures: [{ title: 'Upload', file: file(2) }] });
  else useDocumentStore.getState().setFormData({ basicLetterFile: file(2) });
  pending.resolve(true);
  expect(await restore).toBe('stale');
});

it('commits the original draft as a real safety snapshot before replacement', async () => {
  const actual = await vi.importActual<typeof import('@/lib/documentsDb')>('@/lib/documentsDb');
  addSnapshot.mockImplementation(actual.idbAddSnapshot);
  const documents = useDocumentsStore.getState();
  const target = captureDocumentTarget();
  const incoming = { ...getSerializedSession(), formData: { subject: 'Restored version' } };
  expect(await documents.restoreSnapshot(incoming, target)).toBe('applied');
  const snapshots = await actual.idbGetSnapshots(target!.scope.documentId);
  expect(snapshots.some(snapshot => snapshot.session.formData.subject === 'Current A')).toBe(true);
  await flushDocumentWrites();
  expect((await idbGetAllDocuments())!.find(record => record.id === target!.scope.documentId)!.session.formData.subject).toBe('Restored version');
});
