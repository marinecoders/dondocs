import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BlockParagraphsEditor } from '@/components/editor/BlockParagraphsEditor';
import { prepareFigureUpload } from '@/lib/prepareFigureUpload';
import { SignatureStylePicker } from '@/components/editor/SignatureStylePicker';
import { EnclosuresManager } from '@/components/editor/EnclosuresManager';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { loadSignatureAsPngBase64 } from '@/lib/signatureImage';
import { showAppConfirm } from '@/stores/alertStore';
import type { FormSignatureBlock } from '@/types/signature';
vi.mock('@/lib/prepareFigureUpload', () => ({ prepareFigureUpload: vi.fn() }));
vi.mock('@/lib/attachments', async original => ({ ...await original<typeof import('@/lib/attachments')>(), persistAttachment: vi.fn(async () => ({ id: 'figure-blob', name: 'figure.png', size: 1, type: 'image/png' })) }));
vi.mock('@/lib/signatureImage', () => ({ loadSignatureAsPngBase64: vi.fn() }));
vi.mock('@/stores/alertStore', async original => ({ ...await original<typeof import('@/stores/alertStore')>(), showAppConfirm: vi.fn() }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const block: FormSignatureBlock = { name: 'SIGNER', statement: '', style: 'image' };
function upload() { fireEvent.change(screen.getByLabelText('Upload signature for block 1'), { target: { files: [new File(['x'], 'signature.png', { type: 'image/png' })] } }); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.mocked(loadSignatureAsPngBase64).mockReset(); vi.mocked(showAppConfirm).mockReset();
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
  expect(onChange.mock.calls).toEqual([[{ style: 'image', image: 'NEW' }]]);
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
