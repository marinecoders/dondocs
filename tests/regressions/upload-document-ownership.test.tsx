import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SignatureSection } from '@/components/editor/SignatureSection';
import { EnclosuresManager } from '@/components/editor/EnclosuresManager';
import { EndorsementBasicLetterSection } from '@/components/editor/EndorsementBasicLetterSection';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { idbGetAllDocuments } from '@/lib/documentsDb';
import { loadSignatureAsPngBase64 } from '@/lib/signatureImage';
import { beginDocumentTask, isCurrentDocumentTask } from '@/lib/documentTask';
vi.mock('@/lib/attachments', async original => ({ ...await original<typeof import('@/lib/attachments')>(), persistAttachment: vi.fn(async () => ({id:'test-blob',name:'owned.pdf',size:1,type:'application/pdf'})) }));
vi.mock('@/lib/signatureImage', () => ({ loadSignatureAsPngBase64: vi.fn() }));
vi.mock('@/services/pdf/assembleEndorsement', () => ({ validateBasicLetter: vi.fn(async () => ({ ok: true, pageCount: 4 })) }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function mountSignature() {
  useDocumentStore.getState().setField('signatureType', 'image');
  const view = render(<TooltipProvider><SignatureSection config={DOC_TYPE_CONFIG.naval_letter} /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /Signature Block/ }));
  return view;
}
function uploadSignature(name: string) { fireEvent.change(screen.getByLabelText('Upload signature image'), { target: { files: [new File(['image'], name, { type: 'image/png' })] } }); }
function pendingPdf() {
  const pending = deferred<ArrayBuffer>();
  const file = new File(['pdf'], 'owned.pdf', { type: 'application/pdf' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => pending.promise });
  return { ...pending, file };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.mocked(loadSignatureAsPngBase64).mockReset();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'DOCUMENT A');
});
afterEach(async () => { await flushDocumentWrites(); vi.clearAllTimers(); vi.useRealTimers(); });
it('does not persist a pending signature into the next document', async () => {
  const pending = deferred<string>(); vi.mocked(loadSignatureAsPngBase64).mockReturnValueOnce(pending.promise);
  const view = mountSignature(); uploadSignature('a.png'); view.unmount();
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'DOCUMENT B');
  const b = useDocumentsStore.getState().currentId!;
  await act(async () => { pending.resolve('SIGNATURE_FROM_A'); await pending.promise; });
  useDocumentsStore.getState().saveCurrent(); await flushDocumentWrites();
  expect((await idbGetAllDocuments())!.find(record => record.id === b)!.session.formData.signatureImage).toBeUndefined();
});
it('keeps the newest signature when conversions complete out of order', async () => {
  const older = deferred<string>(); const newer = deferred<string>();
  vi.mocked(loadSignatureAsPngBase64).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  mountSignature(); uploadSignature('old.png'); uploadSignature('new.png');
  await act(async () => { newer.resolve('NEW'); await newer.promise; older.resolve('OLD'); await older.promise; });
  expect(useDocumentStore.getState().formData.signatureImage).toMatchObject({ name: 'new.png', data: 'NEW' });
});
it('does not restore a signature after its style is changed', async () => {
  const pending = deferred<string>(); vi.mocked(loadSignatureAsPngBase64).mockReturnValueOnce(pending.promise);
  mountSignature(); uploadSignature('a.png'); fireEvent.click(screen.getByRole('radio', { name: 'Typed Only' }));
  await act(async () => { pending.resolve('OLD'); await pending.promise; });
  expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
});
it('rejects tasks from an earlier activation of the same document', () => {
  useDocumentsStore.getState().saveCurrent(); const a = useDocumentsStore.getState().currentId!;
  const task = beginDocumentTask('signature-image'); useDocumentsStore.getState().newDocument(); useDocumentsStore.getState().switchTo(a);
  expect(isCurrentDocumentTask(task)).toBe(false);
  expect(isCurrentDocumentTask({ ...task! })).toBe(false);
});
it('attaches an enclosure to its original row after reordering', async () => {
  useDocumentStore.setState({ enclosures: [{ title: 'First' }, { title: 'Second' }] });
  render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ })); const pending = pendingPdf();
  fireEvent.change(screen.getAllByLabelText('Upload enclosure PDFs')[0], { target: { files: [pending.file] } });
  act(() => useDocumentStore.getState().reorderEnclosures(0, 1));
  await act(async () => { pending.resolve(new Uint8Array([1]).buffer); await pending.promise; });
  expect(useDocumentStore.getState().enclosures[0].file).toBeUndefined();
  expect(useDocumentStore.getState().enclosures[1]).toMatchObject({ title: 'First', file: { name: 'owned.pdf' } });
});
it('does not attach a basic letter or its numbering to another document', async () => {
  useDocumentStore.getState().setDocType('new_page_endorsement');
  expect(useDocumentStore.getState().docType).toBe('new_page_endorsement');
  expect(useDocumentStore.getState().formData.basicLetterFile).toBeUndefined();
  const view = render(<TooltipProvider><EndorsementBasicLetterSection /></TooltipProvider>);
  const pending = pendingPdf();
  fireEvent.change(screen.getByLabelText('Upload basic letter PDF'), { target: { files: [pending.file] } }); view.unmount();
  useDocumentsStore.getState().newDocument(); const before = useDocumentStore.getState().formData;
  await act(async () => { pending.resolve(new Uint8Array([1]).buffer); await pending.promise; });
  expect(useDocumentStore.getState().formData).toEqual(before);
});

it('finishes a basic-letter upload with its page continuation', async () => {
  useDocumentStore.getState().setDocType('new_page_endorsement');
  render(<TooltipProvider><EndorsementBasicLetterSection /></TooltipProvider>);
  const pending = pendingPdf();
  fireEvent.change(screen.getByLabelText('Upload basic letter PDF'), { target: { files: [pending.file] } });
  await act(async () => { pending.resolve(new Uint8Array([1]).buffer); await pending.promise; });
  expect(useDocumentStore.getState().formData.basicLetterFileRef?.id).toBe('test-blob');
  expect(useDocumentStore.getState().formData.startingPageNumber).toBe(5);
});
it('ignores a pending enclosure upload after leaving its document', async () => {
  useDocumentStore.setState({ enclosures: [{ title: 'A row' }] });
  const view = render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ })); const pending = pendingPdf();
  fireEvent.change(screen.getAllByLabelText('Upload enclosure PDFs')[0], { target: { files: [pending.file] } }); view.unmount();
  useDocumentsStore.getState().newDocument(); useDocumentStore.setState({ enclosures: [{ title: 'B row' }] });
  await act(async () => { pending.resolve(new Uint8Array([1]).buffer); await pending.promise; });
  expect(useDocumentStore.getState().enclosures).toEqual([{ title: 'B row' }]);
});
it('keeps a signature installed by another editor action during conversion', async () => {
  const pending = deferred<string>(); vi.mocked(loadSignatureAsPngBase64).mockReturnValueOnce(pending.promise);
  mountSignature(); uploadSignature('pending.png');
  act(() => useDocumentStore.getState().setField('signatureImage', { name: 'Profile', size: 1, data: 'PROFILE' }));
  await act(async () => { pending.resolve('STALE'); await pending.promise; });
  expect(useDocumentStore.getState().formData.signatureImage?.data).toBe('PROFILE');
});
