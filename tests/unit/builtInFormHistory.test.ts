import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFormStore } from '@/stores/formStore';
import { captureDocumentScope, changeDocumentHistory, flushDocumentWrites, resetCurrentDocument, useDocumentsStore } from '@/stores/documentsStore';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
});

afterEach(async () => { await flushDocumentWrites(); vi.clearAllTimers(); vi.useRealTimers(); });

it.each(['navmc_10274', 'navmc_118_11'] as const)('preserves Redo after resetting %s to its built-in example', async formType => {
  useDocumentsStore.getState().newDocument(formType);
  expect(resetCurrentDocument()).toBe('applied');
  await vi.advanceTimersByTimeAsync(500);
  const forms = useFormStore.getState();
  const before = formType === 'navmc_10274' ? forms.navmc10274.natureOfAction : forms.navmc11811.remarksText;
  if (formType === 'navmc_10274') forms.setNavmc10274Field('natureOfAction', 'Later edit');
  else forms.setNavmc11811Field('remarksText', 'Later edit');
  await vi.advanceTimersByTimeAsync(500);
  const scope = captureDocumentScope();
  expect(changeDocumentHistory('undo', scope)).toBe('applied');
  expect(formType === 'navmc_10274' ? useFormStore.getState().navmc10274.natureOfAction : useFormStore.getState().navmc11811.remarksText).toBe(before);
  expect(changeDocumentHistory('redo', scope)).toBe('applied');
  expect(formType === 'navmc_10274' ? useFormStore.getState().navmc10274.natureOfAction : useFormStore.getState().navmc11811.remarksText).toBe('Later edit');
});
