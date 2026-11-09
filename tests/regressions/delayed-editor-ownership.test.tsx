import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BlockParagraphsEditor } from '@/components/editor/BlockParagraphsEditor';
import { prepareFigureUpload } from '@/lib/prepareFigureUpload';
import { SignatureStylePicker } from '@/components/editor/SignatureStylePicker';
import { EnclosuresManager } from '@/components/editor/EnclosuresManager';
import { TooltipProvider } from '@/components/ui/tooltip';
import { rehydrateEnclosureFiles, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, isCurrentDocumentScope, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { loadSignatureAsPngBase64 } from '@/lib/signatureImage';
import { isFileImportInProgress } from '@/lib/fileImports';
import { loadAttachment } from '@/lib/attachments';
import { showAppConfirm } from '@/stores/alertStore';
import type { FormSignatureBlock } from '@/types/signature';
vi.mock('@/lib/prepareFigureUpload', () => ({ prepareFigureUpload: vi.fn() }));
vi.mock('@/lib/attachments', async original => ({ ...await original<typeof import('@/lib/attachments')>(), loadAttachment: vi.fn(), persistAttachment: vi.fn(async () => ({ id: 'figure-blob', name: 'figure.png', size: 1, type: 'image/png' })) }));
vi.mock('@/lib/signatureImage', () => ({ loadSignatureAsPngBase64: vi.fn() }));
vi.mock('@/stores/alertStore', async original => ({ ...await original<typeof import('@/stores/alertStore')>(), showAppConfirm: vi.fn() }));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const block: FormSignatureBlock = { name: 'SIGNER', statement: '', style: 'image' };
function upload() { fireEvent.change(screen.getByLabelText('Upload signature for block 1'), { target: { files: [new File(['x'], 'signature.png', { type: 'image/png' })] } }); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.mocked(loadSignatureAsPngBase64).mockReset(); vi.mocked(showAppConfirm).mockReset();
  vi.mocked(loadAttachment).mockReset().mockResolvedValue(null);
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
  useDocumentsStore.getState().newDocument();
});
afterEach(async () => { await flushDocumentWrites(); vi.clearAllTimers(); vi.useRealTimers(); });
it('ignores a form signature from an earlier activation, even on return to its document', async () => {
  const pending = deferred<string>(); vi.mocked(loadSignatureAsPngBase64).mockReturnValueOnce(pending.promise);
  const onChange = vi.fn(); render(<SignatureStylePicker block={block} index={0} onChange={onChange} />);
  upload(); useDocumentsStore.getState().saveCurrent(); const a = useDocumentsStore.getState().currentId!;
  act(() => { useDocumentsStore.getState().newDocument(); useDocumentsStore.getState().switchTo(a); });
  await act(async () => { pending.resolve('STALE'); await pending.promise; });
  expect(onChange).not.toHaveBeenCalled();
});
it('keeps only the latest form signature conversion', async () => {
  const older = deferred<string>(), newer = deferred<string>();
  vi.mocked(loadSignatureAsPngBase64).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  const onChange = vi.fn(); render(<SignatureStylePicker block={block} index={0} onChange={onChange} />);
  upload(); upload();
  await act(async () => { newer.resolve('NEW'); await newer.promise; older.resolve('OLD'); await older.promise; });
  expect(onChange.mock.calls).toEqual([[{ style: 'image', image: 'NEW', imageRef: { id: 'figure-blob', name: 'figure.png', size: 1, type: 'image/png' } }]]);
});
it('does not overwrite edits to the signer while decoding its image', async () => {
  const pending = deferred<string>(); vi.mocked(loadSignatureAsPngBase64).mockReturnValueOnce(pending.promise);
  const onChange = vi.fn(); const view = render(<SignatureStylePicker block={block} index={0} onChange={onChange} />);
  upload(); view.rerender(<SignatureStylePicker block={{ ...block, name: 'EDITED' }} index={0} onChange={onChange} />);
  await act(async () => { pending.resolve('STALE'); await pending.promise; }); expect(onChange).not.toHaveBeenCalled();
});
it('does not remove a new document enclosure after an old confirmation resolves', async () => {
  const pending = deferred<boolean>(); vi.mocked(showAppConfirm).mockReturnValueOnce(pending.promise);
  useDocumentStore.setState({ enclosures: [{ title: 'A' }] });
  render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove enclosure 1' }));
  act(() => { useDocumentsStore.getState().newDocument(); useDocumentStore.setState({ enclosures: [{ title: 'B' }] }); });
  await act(async () => { pending.resolve(true); await pending.promise; });
  expect(useDocumentStore.getState().enclosures).toEqual([{ title: 'B' }]);
});
it('cancels removal when the confirmation target was edited', async () => {
  const pending = deferred<boolean>(); vi.mocked(showAppConfirm).mockReturnValueOnce(pending.promise);
  useDocumentStore.setState({ enclosures: [{ title: 'Original' }] });
  render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove enclosure 1' }));
  act(() => useDocumentStore.getState().updateEnclosure(0, { title: 'Edited' }));
  await act(async () => { pending.resolve(true); await pending.promise; });
  expect(useDocumentStore.getState().enclosures).toEqual([{ title: 'Edited' }]);
});
it('removes an unchanged enclosure after confirmation', async () => {
  vi.mocked(showAppConfirm).mockResolvedValueOnce(true);
  useDocumentStore.setState({ enclosures: [{ title: 'Original' }] });
  render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove enclosure 1' })));
  expect(useDocumentStore.getState().enclosures).toEqual([]);
});

it('does not attach a pending figure to a replacement document', async () => {
  const pending = deferred<Awaited<ReturnType<typeof prepareFigureUpload>>>();
  vi.mocked(prepareFigureUpload).mockReturnValueOnce(pending.promise);
  useDocumentStore.setState({ paragraphs: [{ text: 'Figure A', level: 0, figure: {} }] });
  const view = render(<TooltipProvider><BlockParagraphsEditor /></TooltipProvider>);
  fireEvent.change(screen.getByLabelText(/^Image for figure/), { target: { files: [new File(['x'], 'figure.png', { type: 'image/png' })] } });
  view.unmount();
  act(() => { useDocumentsStore.getState().newDocument(); useDocumentStore.setState({ paragraphs: [{ text: 'Figure B', level: 0, figure: {} }] }); });
  await act(async () => { pending.resolve({ bytes: new ArrayBuffer(1), type: 'image/png', width: 1, height: 1 }); await pending.promise; });
  expect(useDocumentStore.getState().paragraphs[0]).toEqual({ text: 'Figure B', level: 0, figure: {} });
});
it('attaches a figure to its original row after reordering', async () => {
  const pending = deferred<Awaited<ReturnType<typeof prepareFigureUpload>>>();
  vi.mocked(prepareFigureUpload).mockReturnValueOnce(pending.promise);
  useDocumentStore.setState({ paragraphs: [{ text: 'Figure A', level: 0, figure: {} }, { text: 'Other', level: 0 }] });
  render(<TooltipProvider><BlockParagraphsEditor /></TooltipProvider>);
  fireEvent.change(screen.getByLabelText(/^Image for figure/), { target: { files: [new File(['x'], 'figure.png', { type: 'image/png' })] } });
  act(() => useDocumentStore.getState().reorderParagraphs(0, 1));
  await act(async () => { pending.resolve({ bytes: new ArrayBuffer(1), type: 'image/png', width: 1, height: 1 }); await pending.promise; });
  expect(useDocumentStore.getState().paragraphs[0].figure).toBeUndefined();
  expect(useDocumentStore.getState().paragraphs[1].figure?.fileRef?.id).toBe('figure-blob');
});

it('blocks application updates through a form signature upload', async () => {
  const normalize = (await vi.importActual<typeof import('@/lib/signatureImage')>('@/lib/signatureImage')).loadSignatureAsPngBase64;
  vi.mocked(loadSignatureAsPngBase64).mockImplementationOnce(normalize);
  const reading = deferred<ArrayBuffer>();
  const file = new File(['image'], 'signature.png', { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => reading.promise });
  const onChange = vi.fn();
  render(<SignatureStylePicker block={block} index={0} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Upload signature for block 1'), { target: { files: [file] } });
  const blockedDuringRead = isFileImportInProgress();
  await act(async () => { reading.resolve(new Uint8Array([1]).buffer); await reading.promise; });
  expect(blockedDuringRead).toBe(true);
  expect(isFileImportInProgress()).toBe(false);
  expect(onChange).toHaveBeenCalledWith({ style: 'image', image: 'AQ==', imageRef: { id: 'figure-blob', name: 'figure.png', size: 1, type: 'image/png' } });
});

it('removes a confirmed enclosure when its saved bytes hydrate while confirmation is open', async () => {
  const reference = { id: 'saved', name: 'saved.pdf', size: 1, type: 'application/pdf' };
  useDocumentStore.setState({ enclosures: [{ title: 'Original', fileRef: reference }] });
  const stored = deferred<ArrayBuffer>();
  vi.mocked(loadAttachment).mockReturnValueOnce(stored.promise);
  const scope = captureDocumentScope();
  const hydration = rehydrateEnclosureFiles(() => isCurrentDocumentScope(scope));
  const confirmation = deferred<boolean>();
  vi.mocked(showAppConfirm).mockReturnValueOnce(confirmation.promise);
  render(<TooltipProvider><EnclosuresManager /></TooltipProvider>);
  fireEvent.click(screen.getByRole('button', { name: /^Enclosures/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove enclosure 1' }));
  await act(async () => { stored.resolve(new Uint8Array([1]).buffer); await hydration; });
  await act(async () => { confirmation.resolve(true); await confirmation.promise; });
  expect(useDocumentStore.getState().enclosures).toEqual([]);
});

it.each(['remove', 'reorder'] as const)('does not show an old figure upload error after its row is changed by %s', async action => {
  const pending = deferred<Awaited<ReturnType<typeof prepareFigureUpload>>>();
  vi.mocked(prepareFigureUpload).mockReturnValueOnce(pending.promise);
  useDocumentStore.setState({ paragraphs: [{ text: 'Figure A', level: 0, figure: {} }, { text: 'Figure B', level: 0, figure: {} }] });
  render(<TooltipProvider><BlockParagraphsEditor /></TooltipProvider>);
  fireEvent.change(screen.getAllByLabelText(/^Image for figure/)[0], { target: { files: [new File(['x'], 'figure.png', { type: 'image/png' })] } });
  act(() => {
    if (action === 'remove') useDocumentStore.getState().removeParagraph(0);
    else useDocumentStore.getState().reorderParagraphs(0, 1);
  });
  await act(async () => { pending.reject(new Error('STALE FIGURE ERROR')); await pending.promise.catch(() => {}); });
  expect(screen.queryByText('STALE FIGURE ERROR')).not.toBeInTheDocument();
  expect(isFileImportInProgress()).toBe(false);
});
