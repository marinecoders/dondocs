import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SignatureSection } from '@/components/editor/SignatureSection';
import { EnclosuresManager } from '@/components/editor/EnclosuresManager';
import { EndorsementBasicLetterSection } from '@/components/editor/EndorsementBasicLetterSection';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { rehydrateEnclosureFiles, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, isCurrentDocumentScope, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { idbGetAllDocuments } from '@/lib/documentsDb';
import { loadSignatureAsPngBase64 } from '@/lib/signatureImage';
import { beginDocumentTask, isCurrentDocumentTask } from '@/lib/documentTask';
import { isFileImportInProgress } from '@/lib/fileImports';
import { loadAttachment } from '@/lib/attachments';
vi.mock('@/lib/attachments', async original => ({ ...await original<typeof import('@/lib/attachments')>(), loadAttachment: vi.fn(), persistAttachment: vi.fn(async () => ({id:'test-blob',name:'owned.pdf',size:1,type:'application/pdf'})) }));
vi.mock('@/lib/signatureImage', () => ({ loadSignatureAsPngBase64: vi.fn() }));
vi.mock('@/services/pdf/assembleEndorsement', () => ({ validateBasicLetter: vi.fn(async () => ({ ok: true, pageCount: 4 })) }));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
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
  vi.mocked(loadAttachment).mockReset().mockResolvedValue(null);
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
  expect(isFileImportInProgress()).toBe(true);
  act(() => useDocumentStore.getState().reorderEnclosures(0, 1));
  await act(async () => { pending.resolve(new Uint8Array([1]).buffer); await pending.promise; });
  expect(useDocumentStore.getState().enclosures[0].file).toBeUndefined();
  expect(useDocumentStore.getState().enclosures[1]).toMatchObject({ title: 'First', file: { name: 'owned.pdf' } });
  expect(isFileImportInProgress()).toBe(false);
});
it('keeps an enclosure upload when its title is edited before it finishes', async () => {
  useDocumentStore.setState({ enclosures: [{ title: 'First' }, { title: 'Second' }] });
  render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  const pending = pendingPdf();
  fireEvent.change(screen.getAllByLabelText('Upload enclosure PDFs')[0], { target: { files: [pending.file] } });
  fireEvent.change(screen.getByLabelText('Enclosure (1) title'), { target: { value: 'Updated title' } });
  act(() => useDocumentStore.getState().reorderEnclosures(0, 1));
  await act(async () => { pending.resolve(new Uint8Array([1]).buffer); await pending.promise; });
  expect(useDocumentStore.getState().enclosures[0].file).toBeUndefined();
  expect(useDocumentStore.getState().enclosures[1]).toMatchObject({ title: 'Updated title', file: { name: 'owned.pdf' } });
});
it('supersedes an earlier enclosure upload after a title edit', async () => {
  useDocumentStore.setState({ enclosures: [{ title: 'First' }] });
  render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  const older = pendingPdf();
  const newer = pendingPdf();
  fireEvent.change(screen.getAllByLabelText('Upload enclosure PDFs')[0], { target: { files: [older.file] } });
  fireEvent.change(screen.getByLabelText('Enclosure (1) title'), { target: { value: 'Updated title' } });
  fireEvent.change(screen.getAllByLabelText('Upload enclosure PDFs')[0], { target: { files: [newer.file] } });
  await act(async () => { older.resolve(new Uint8Array([1]).buffer); await older.promise; });
  expect(useDocumentStore.getState().enclosures[0].file).toBeUndefined();
  await act(async () => { newer.resolve(new Uint8Array([2]).buffer); await newer.promise; });
  expect(new Uint8Array(useDocumentStore.getState().enclosures[0].file!.data)).toEqual(new Uint8Array([2]));
});
it('does not install a pending upload after its enclosure file is replaced', async () => {
  useDocumentStore.setState({ enclosures: [{ title: 'First' }] });
  render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  const pending = pendingPdf();
  fireEvent.change(screen.getAllByLabelText('Upload enclosure PDFs')[0], { target: { files: [pending.file] } });
  const replacement = { name: 'replacement.pdf', size: 1, data: new Uint8Array([2]).buffer };
  act(() => useDocumentStore.getState().updateEnclosure(0, { file: replacement }));
  await act(async () => { pending.resolve(new Uint8Array([1]).buffer); await pending.promise; });
  expect(useDocumentStore.getState().enclosures[0].file).toBe(replacement);
});
it('does not install a pending upload into a replacement enclosure at the same position', async () => {
  useDocumentStore.setState({ enclosures: [{ title: 'First' }] });
  render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  const pending = pendingPdf();
  fireEvent.change(screen.getAllByLabelText('Upload enclosure PDFs')[0], { target: { files: [pending.file] } });
  act(() => {
    useDocumentStore.getState().removeEnclosure(0);
    useDocumentStore.getState().addEnclosure('Replacement');
  });
  await act(async () => { pending.resolve(new Uint8Array([1]).buffer); await pending.promise; });
  expect(useDocumentStore.getState().enclosures).toEqual([{ title: 'Replacement' }]);
});
it('does not attach a basic letter or its numbering to another document', async () => {
  useDocumentStore.getState().setDocType('new_page_endorsement');
  expect(useDocumentStore.getState().docType).toBe('new_page_endorsement');
  expect(useDocumentStore.getState().formData.basicLetterFile).toBeUndefined();
  const view = render(<TooltipProvider><EndorsementBasicLetterSection /></TooltipProvider>);
  const pending = pendingPdf();
  fireEvent.change(screen.getByLabelText('Upload basic letter PDF'), { target: { files: [pending.file] } });
  expect(isFileImportInProgress()).toBe(true);
  view.unmount();
  useDocumentsStore.getState().newDocument(); const before = useDocumentStore.getState().formData;
  await act(async () => { pending.resolve(new Uint8Array([1]).buffer); await pending.promise; });
  expect(useDocumentStore.getState().formData).toEqual(before);
  expect(isFileImportInProgress()).toBe(false);
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

it.each(['complete', 'cancel', 'reject'] as const)('blocks application updates during a signature upload (%s)', async outcome => {
  const normalize = (await vi.importActual<typeof import('@/lib/signatureImage')>('@/lib/signatureImage')).loadSignatureAsPngBase64;
  vi.mocked(loadSignatureAsPngBase64).mockImplementationOnce(normalize);
  const pending = deferred<ArrayBuffer>();
  const file = new File(['image'], 'signature.png', { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => pending.promise });
  mountSignature();
  fireEvent.change(screen.getByLabelText('Upload signature image'), { target: { files: [file] } });
  const blockedDuringRead = isFileImportInProgress();

  if (outcome === 'cancel') act(() => useDocumentsStore.getState().newDocument());
  await act(async () => {
    if (outcome === 'reject') pending.reject(new Error('Image read failed'));
    else pending.resolve(new Uint8Array([1]).buffer);
    await pending.promise.catch(() => {});
  });

  expect(blockedDuringRead).toBe(true);
  expect(isFileImportInProgress()).toBe(false);
  if (outcome === 'complete') expect(useDocumentStore.getState().formData.signatureImage?.name).toBe('signature.png');
  else expect(useDocumentStore.getState().formData.signatureImage).toBeUndefined();
});

it.each(['enclosure', 'basic-letter'] as const)('keeps an explicit %s upload when the saved file hydrates during its read', async kind => {
  const reference = { id: 'saved-file', name: 'saved.pdf', size: 1, type: 'application/pdf' };
  if (kind === 'enclosure') useDocumentStore.setState({ enclosures: [{ title: 'Existing', fileRef: reference }] });
  else {
    useDocumentStore.getState().setDocType('new_page_endorsement');
    useDocumentStore.getState().setField('basicLetterFileRef', reference);
  }
  const stored = deferred<ArrayBuffer>();
  vi.mocked(loadAttachment).mockReturnValueOnce(stored.promise);
  const scope = captureDocumentScope();
  const hydration = rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  render(<TooltipProvider>{kind === 'enclosure' ? <EnclosuresManager /> : <EndorsementBasicLetterSection />}</TooltipProvider>);
  if (kind === 'enclosure') fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  const upload = pendingPdf();
  const input = kind === 'enclosure' ? screen.getAllByLabelText('Upload enclosure PDFs')[0] : screen.getByLabelText('Upload basic letter PDF');
  fireEvent.change(input, { target: { files: [upload.file] } });

  await act(async () => { stored.resolve(new Uint8Array([1]).buffer); await hydration; });
  const hydrated = kind === 'enclosure' ? useDocumentStore.getState().enclosures[0].file : useDocumentStore.getState().formData.basicLetterFile;
  await act(async () => { upload.resolve(new Uint8Array([2]).buffer); await upload.promise; });

  expect(hydrated?.name).toBe('saved.pdf');
  const current = kind === 'enclosure' ? useDocumentStore.getState().enclosures[0].file : useDocumentStore.getState().formData.basicLetterFile;
  expect(current?.name).toBe('owned.pdf');
  expect(new Uint8Array(current!.data)).toEqual(new Uint8Array([2]));
  expect(isFileImportInProgress()).toBe(false);
});

it.each([false, true])('keeps another basic-letter replacement while an upload is pending (saved handle: %s)', async saved => {
  useDocumentStore.getState().setDocType('new_page_endorsement');
  if (saved) useDocumentStore.getState().setField('basicLetterFileRef', { id: 'saved-file', name: 'same.pdf', size: 1, type: 'application/pdf' });
  render(<TooltipProvider><EndorsementBasicLetterSection /></TooltipProvider>);
  const upload = pendingPdf();
  fireEvent.change(screen.getByLabelText('Upload basic letter PDF'), { target: { files: [upload.file] } });
  const replacement = { name: 'same.pdf', size: 1, data: new Uint8Array([3]).buffer };
  act(() => useDocumentStore.getState().setField('basicLetterFile', replacement));
  await act(async () => { upload.resolve(new Uint8Array([2]).buffer); await upload.promise; });
  expect(useDocumentStore.getState().formData.basicLetterFile).toBe(replacement);
  expect(isFileImportInProgress()).toBe(false);
});
