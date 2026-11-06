import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { saveCheckpoint } from '@/lib/saveCheckpoint';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import * as db from '@/lib/documentsDb';
import { STORAGE_KEYS } from '@/lib/constants';
import { showAppAlert } from '@/stores/alertStore';
vi.mock('@/stores/alertStore', () => ({ showAppAlert: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ isMobile: false, previewVisible: true, mobilePreviewOpen: false });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Checkpoint draft');
});
afterEach(async () => { vi.restoreAllMocks(); await flushDocumentWrites(); });

it.each([false, true])('toggles the visible preview surface (mobile=%s) without changing the other preference', (mobile) => {
  useUIStore.setState({ isMobile: mobile });
  useUIStore.getState().togglePreview();
  expect(useUIStore.getState()).toMatchObject(mobile
    ? { mobilePreviewOpen: true, previewVisible: true }
    : { mobilePreviewOpen: false, previewVisible: false });
  useUIStore.getState().togglePreview();
  expect(useUIStore.getState()).toMatchObject({ mobilePreviewOpen: false, previewVisible: true });
});

it.each(['correspondence', 'forms'] as const)('saves a reusable manual checkpoint and flushes the %s draft', async (documentCategory) => {
  useDocumentStore.setState({ documentCategory, formType: 'navmc_118_11' });
  useFormStore.getState().setNavmc11811Field('remarksText', 'Checkpoint remarks');
  expect(await saveCheckpoint()).toBe(true);
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.DOCUMENT)!);
  expect(saved.documentCategory).toBe(documentCategory);
  if (documentCategory === 'correspondence') expect(saved.formData.subject).toBe('Checkpoint draft');
  if (documentCategory === 'forms') expect(saved.forms.navmc11811.remarksText).toBe('Checkpoint remarks');
  const id = useDocumentsStore.getState().currentId;
  const committed = (await db.idbGetAllDocuments())!.find(record => record.id === id);
  expect(committed?.session.documentCategory).toBe(documentCategory);
});

it('keeps the previous checkpoint and live draft when storage rejects the new one', async () => {
  localStorage.setItem(STORAGE_KEYS.DOCUMENT, 'previous checkpoint');
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
  expect(await saveCheckpoint()).toBe(false);
  expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT)).toBe('previous checkpoint');
  expect(useDocumentStore.getState().formData.subject).toBe('Checkpoint draft');
  expect(showAppAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not save checkpoint' }));
});

it('does not acknowledge a checkpoint while its durable write is pending', async () => {
  let finish!: (outcome: db.DocumentWriteOutcome) => void;
  vi.spyOn(db, 'idbWriteDocument').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let settled = false;
  const saving = saveCheckpoint().then(result => { settled = true; return result; });
  try {
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(useUIStore.getState().saveStatus).toBe('saving');
  } finally { finish('committed'); }
  expect(await saving).toBe(true);
  expect(useUIStore.getState().saveStatus).toBe('saved');
});
it.each(['navmc_10274', 'navmc_118_11'] as const)('does not acknowledge %s from localStorage alone', async formType => {
  useDocumentStore.setState({ documentCategory: 'forms', formType });
  vi.spyOn(db, 'idbWriteDocument').mockResolvedValue('failed');
  expect(await saveCheckpoint()).toBe(false);
  expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT)).not.toBeNull();
  expect(useUIStore.getState().saveStatus).toBe('error');
});
it('does not report completion for a different document after navigation', async () => {
  let finish!: (outcome: db.DocumentWriteOutcome) => void;
  vi.spyOn(db, 'idbWriteDocument').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const saving = saveCheckpoint();
  useDocumentsStore.getState().newDocument();
  finish('committed');
  expect(await saving).toBe(false);
  expect(useUIStore.getState().saveStatus).not.toBe('saved');
});

it('saves the current document even when a different document has a write conflict', async () => {
  const other = useDocumentsStore.getState().currentId!;
  const original = db.idbWriteDocument;
  const write = vi.spyOn(db, 'idbWriteDocument').mockImplementation((before, after) => after.id === other ? Promise.resolve('conflict') : original(before, after));
  useDocumentsStore.getState().saveCurrent();
  await Promise.resolve(); await Promise.resolve();
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Independent save');
  expect(await saveCheckpoint()).toBe(true);
  expect(useUIStore.getState().saveStatus).toBe('saved');
  write.mockRestore();
});
