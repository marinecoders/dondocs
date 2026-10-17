import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { saveCheckpoint } from '@/lib/saveCheckpoint';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import { STORAGE_KEYS } from '@/lib/constants';
import { showAppAlert } from '@/stores/alertStore';
vi.mock('@/stores/alertStore', () => ({ showAppAlert: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ isMobile: false, previewVisible: true, mobilePreviewOpen: false });
  useDocumentStore.getState().resetForm();
  useDocumentStore.getState().setField('subject', 'Checkpoint draft');
});
afterEach(() => vi.restoreAllMocks());

it.each([false, true])('toggles the visible preview surface (mobile=%s) without changing the other preference', (mobile) => {
  useUIStore.setState({ isMobile: mobile });
  useUIStore.getState().togglePreview();
  expect(useUIStore.getState()).toMatchObject(mobile
    ? { mobilePreviewOpen: true, previewVisible: true }
    : { mobilePreviewOpen: false, previewVisible: false });
  useUIStore.getState().togglePreview();
  expect(useUIStore.getState()).toMatchObject({ mobilePreviewOpen: false, previewVisible: true });
});

it.each(['correspondence', 'forms'] as const)('saves a reusable manual checkpoint and flushes the %s draft', (documentCategory) => {
  useDocumentStore.setState({ documentCategory, formType: 'navmc_118_11' });
  useFormStore.getState().setNavmc11811Field('remarksText', 'Checkpoint remarks');
  const save = vi.spyOn(useDocumentsStore.getState(), 'saveCurrent').mockImplementation(() => {});
  expect(saveCheckpoint()).toBe(true);
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.DOCUMENT)!);
  expect(saved.documentCategory).toBe(documentCategory);
  if (documentCategory === 'correspondence') expect(saved.formData.subject).toBe('Checkpoint draft');
  if (documentCategory === 'forms') expect(saved.forms.navmc11811.remarksText).toBe('Checkpoint remarks');
  expect(save).toHaveBeenCalledOnce();
});

it('keeps the previous checkpoint and live draft when storage rejects the new one', () => {
  localStorage.setItem(STORAGE_KEYS.DOCUMENT, 'previous checkpoint');
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
  expect(saveCheckpoint()).toBe(false);
  expect(localStorage.getItem(STORAGE_KEYS.DOCUMENT)).toBe('previous checkpoint');
  expect(useDocumentStore.getState().formData.subject).toBe('Checkpoint draft');
  expect(showAppAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not save checkpoint' }));
});
