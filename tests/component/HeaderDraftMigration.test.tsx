import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { Header } from '@/components/layout/Header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';

it('imports an older draft without saving intermediate import state over the open letter', async () => {
  useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'EXISTING LETTER');
  useDocumentsStore.getState().saveCurrent();
  const id = useDocumentsStore.getState().currentId!;
  const original = structuredClone(useDocumentsStore.getState().docs[id]);
  render(<TooltipProvider><Header /></TooltipProvider>);
  const input = document.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File([JSON.stringify({
    version: 1, documentCategory: 'correspondence', documentMode: 'custom', docType: 'memorandum',
    formType: 'navmc_118_11', formData: { subject: 'IMPORTED LETTER' }, paragraphs: [{ text: 'Imported body', level: 0 }],
    forms: { navmc10274: { actionNo: '0003' } },
  })], 'old-draft.json', { type: 'application/json' })] } });
  await waitFor(() => expect(useDocumentStore.getState().formData.subject).toBe('IMPORTED LETTER'));
  await waitFor(() => expect(useDocumentsStore.getState().currentId).not.toBe(id));
  expect(useDocumentsStore.getState().docs[id]).toEqual(original);
  expect(useFormStore.getState().navmc10274.signatureBlocks).toEqual([]);
});
