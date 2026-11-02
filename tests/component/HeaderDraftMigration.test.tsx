import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { fireEvent, render, waitFor, screen } from '@testing-library/react';
import { Header } from '@/components/layout/Header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import { sl3Fixture } from '../_helpers/sl3Fixture';
import { loadAttachment } from '@/lib/attachments';

it('imports an older draft without saving intermediate import state over the open letter', async () => {
  useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'EXISTING LETTER');
  useDocumentsStore.getState().saveCurrent();
  const id = useDocumentsStore.getState().currentId!;
  const originalSignatures = structuredClone(useFormStore.getState().navmc10274.signatureBlocks);
  const original = structuredClone(useDocumentsStore.getState().docs[id]);
  render(<TooltipProvider><Header /></TooltipProvider>);
  const input = document.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File([JSON.stringify({
    version: 1, documentCategory: 'correspondence', documentMode: 'custom', docType: 'plain_paper_memorandum',
    formType: 'navmc_118_11', formData: { subject: 'IMPORTED LETTER' }, paragraphs: [{ text: 'Imported body', level: 0 }],
    forms: { navmc10274: { actionNo: '0003' } },
  })], 'old-draft.json', { type: 'application/json' })] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Open as new document' }));
  await waitFor(() => expect(useDocumentStore.getState().formData.subject).toBe('IMPORTED LETTER'));
  await waitFor(() => expect(useDocumentsStore.getState().currentId).not.toBe(id));
  expect(useDocumentsStore.getState().docs[id]).toEqual(original);
  expect(useFormStore.getState().navmc10274.signatureBlocks).toEqual(originalSignatures);
});

it('counts embedded SL-3 illustrations in the review and restores both files on import', async () => {
  useDocumentsStore.setState({ docs: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  const fixture = sl3Fixture();
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const draft = { version: '1.1', documentMode: 'compliant', documentCategory: 'correspondence', docType: 'sl3',
    formData: fixture.formData, endItems: fixture.endItems, references: [], enclosures: [], copyTos: [],
    paragraphs: ['kit', 'module'].map((referenceId) => ({ referenceId, text: referenceId, level: 0,
      figure: { name: `${referenceId}.png`, type: 'image/png', data } })),
  };
  render(<TooltipProvider><Header /></TooltipProvider>);
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File([JSON.stringify(draft)], 'sl3.json', { type: 'application/json' })] } });
  expect(await screen.findByText('0 enclosure files and 2 illustrations included.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open as new document' }));
  await waitFor(() => expect(useDocumentStore.getState().paragraphs.every((p) => p.figure?.fileRef)).toBe(true));
  expect(useDocumentStore.getState().paragraphs).toHaveLength(2);
  for (const p of useDocumentStore.getState().paragraphs) {
    const bytes = await loadAttachment(p.figure!.fileRef!.id);
    expect([...new Uint8Array(bytes!).slice(0, 4)]).toEqual([137, 80, 78, 71]);
  }
});
