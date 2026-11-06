import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EnclosuresManager } from '@/components/editor/EnclosuresManager';
import { EndorsementBasicLetterSection } from '@/components/editor/EndorsementBasicLetterSection';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import * as db from '@/lib/documentsDb';
import { showAppAlert } from '@/stores/alertStore';
vi.mock('@/stores/alertStore', async original => ({ ...await original<typeof import('@/stores/alertStore')>(), showAppAlert: vi.fn() }));
vi.mock('@/services/pdf/assembleEndorsement', () => ({ validateBasicLetter: vi.fn(async () => ({ ok: true, pageCount: 4 })) }));
beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
  useDocumentsStore.getState().newDocument();
  vi.spyOn(db, 'idbPutAttachment').mockResolvedValue(false);
});
afterEach(async () => { vi.restoreAllMocks(); await flushDocumentWrites(); });
function pdf() {
  const file = new File(['pdf'], 'upload.pdf', { type: 'application/pdf' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(1) });
  return file;
}
it('keeps the previous enclosure when its replacement bytes cannot be saved', async () => {
  useDocumentStore.setState({ enclosures: [{ title: 'Original' }] });
  render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  await act(async () => fireEvent.change(screen.getAllByLabelText('Upload enclosure PDFs')[0], { target: { files: [pdf()] } }));
  expect(useDocumentStore.getState().enclosures).toEqual([{ title: 'Original' }]);
  expect(showAppAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not attach PDF' }));
});
it('does not install a basic-letter handle or numbering after a failed byte write', async () => {
  useDocumentStore.getState().setDocType('new_page_endorsement');
  render(<TooltipProvider><EndorsementBasicLetterSection /></TooltipProvider>);
  const before = useDocumentStore.getState().formData;
  await act(async () => fireEvent.change(screen.getByLabelText('Upload basic letter PDF'), { target: { files: [pdf()] } }));
  expect(useDocumentStore.getState().formData).toEqual(before);
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save upload.pdf');
});
