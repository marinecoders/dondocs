import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReadyExportJob } from '@/lib/preparedExport';
const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('@/config/classification', async () => {
  const { resolveExportDeploymentPolicy } = await import('@/lib/exportDeploymentPolicy');
  return { getExportDeploymentPolicy: async () => resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }) };
});
vi.mock('@/services/exports/batchRows', async original => ({ ...await original<typeof import('@/services/exports/batchRows')>(), renderPreparedBatchRow: mocks.render }));
import { BatchModal } from '@/components/modals/BatchModal';
import { useBatchStore, runBatchJob } from '@/stores/batchStore';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { createExportArtifact } from '@/lib/exportExecution';
import { copyPreparedDocument } from '@/lib/preparedExport';
import { clearBatchExports } from '@/services/exports/batchExecution';

beforeEach(() => {
  expect(clearBatchExports()).toBe(true);
  mocks.render.mockReset().mockImplementation(async (ready: ReadyExportJob) => createExportArtifact(ready, new Blob(['pdf'])));
  useDocumentsStore.getState().newDocument();
  useUIStore.setState({ batchModalOpen: true });
  useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'standard_letter', documentMode: 'compliant',
    formData: { subject: 'ORIGINAL' }, paragraphs: [{ text: 'SSN {{ID}}', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] });
  useBatchStore.setState({ source: null, jobId: null, review: null, title: '', placeholders: [], status: 'idle', stopRequested: false, recoveryError: '', rows: [
    { id: 'one', values: { ID: '123-45-6789' }, status: 'pending' }, { id: 'two', values: { ID: '987-65-4321' }, status: 'pending' },
  ] });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup();vi.restoreAllMocks();expect(clearBatchExports()).toBe(true); });
function open() { render(<BatchModal compile={async () => null} isEngineReady waitForReady={async () => true} />); }
it('reviews each row separately and keeps the frozen source after the active editor changes', async () => {
  open();fireEvent.click(screen.getByRole('button', { name: 'Generate 2 PDFs' }));
  await screen.findByRole('dialog', { name: 'Review batch row' });
  expect(mocks.render).not.toHaveBeenCalled();
  act(() => { useDocumentStore.getState().setField('subject', 'DIFFERENT'); });
  fireEvent.click(screen.getByRole('button', { name: 'Continue with this row' }));
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(useBatchStore.getState().review?.rowId).toBe('two'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue with this row' }));
  await vi.waitFor(() => expect(useBatchStore.getState().status).toBe('complete'));
  expect(mocks.render).toHaveBeenCalledTimes(2);
  expect(mocks.render.mock.calls.map(([ready]) => copyPreparedDocument(ready).document.formData.subject)).toEqual(['ORIGINAL', 'ORIGINAL']);
  expect(mocks.render.mock.calls.map(([ready]) => copyPreparedDocument(ready).document.paragraphs[0].text)).toEqual(['SSN 123-45-6789', 'SSN 987-65-4321']);
});
it('cancels the reviewed row and leaves remaining rows pending', async () => {
  open();fireEvent.click(screen.getByRole('button', { name: 'Generate 2 PDFs' }));
  await screen.findByRole('dialog', { name: 'Review batch row' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel row and pause batch' }));
  await vi.waitFor(() => expect(useBatchStore.getState().status).toBe('paused'));
  expect(useBatchStore.getState().rows.map(row => row.status)).toEqual(['error', 'pending']);
  expect(mocks.render).not.toHaveBeenCalled();
});

it('keeps other row previews disabled while a preview owns the worker', async () => {
  let finish!: (artifact: ReturnType<typeof createExportArtifact>) => void;
  mocks.render.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  open();fireEvent.click(screen.getByRole('button', { name: 'Preview row 1' }));
  await screen.findByRole('dialog', { name: 'Review batch row' });
  fireEvent.click(screen.getByRole('button', { name: 'Continue with this row' }));
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview row 2' })); });
    expect(screen.queryByText(/Finish or cancel the active row/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview row 2' })).toBeDisabled();
  } finally {
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await act(async () => { finish(createExportArtifact(mocks.render.mock.calls[0][0], new Blob(['pdf']))); });
    await vi.waitFor(() => expect(clearBatchExports()).toBe(true));
  }
});

it('keeps batch generation blocked until a closed preview worker settles', async () => {
  let finish!: (artifact: ReturnType<typeof createExportArtifact>) => void;
  mocks.render.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  open();fireEvent.click(screen.getByRole('button', { name: 'Preview row 1' }));
  await screen.findByRole('dialog', { name: 'Review batch row' });
  fireEvent.click(screen.getByRole('button', { name: 'Continue with this row' }));
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
  act(() => useUIStore.setState({ batchModalOpen: true }));
  try {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Generate 2 PDFs' })); });
    expect(useBatchStore.getState().rows.map(row => row.status)).toEqual(['pending', 'pending']);
    expect(useBatchStore.getState().status).toBe('idle');
    expect(screen.getByRole('button', { name: 'Generate 2 PDFs' })).toBeDisabled();
  } finally {
    await act(async () => { finish(createExportArtifact(mocks.render.mock.calls[0][0], new Blob(['pdf']))); });
    await vi.waitFor(() => expect(clearBatchExports()).toBe(true));
  }
  expect(screen.getByRole('button', { name: 'Generate 2 PDFs' })).toBeEnabled();
  expect(screen.queryByRole('dialog', { name: 'Document Preview' })).not.toBeInTheDocument();
  expect(useBatchStore.getState().rows.map(row => row.status)).toEqual(['pending', 'pending']);
});


it('keeps remounted preview worker ownership and untouched rows', async () => {
  let finish!: (artifact: ReturnType<typeof createExportArtifact>) => void;
  mocks.render.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<BatchModal compile={async () => null} isEngineReady waitForReady={async () => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Preview row 1' }));
  await screen.findByRole('dialog', { name: 'Review batch row' });
  fireEvent.click(screen.getByRole('button', { name: 'Continue with this row' }));
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
  view.unmount();
  render(<BatchModal compile={async () => null} isEngineReady waitForReady={async () => true} />);
  try {
    expect(screen.getByRole('button', { name: 'Generate 2 PDFs' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview row 2' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Generate 2 PDFs' }));
    const generate = vi.fn(async () => new Uint8Array([1]));
    await runBatchJob({ source: getSerializedSession(), title: 'Unstarted batch', placeholders: ['ID'], generate, download: vi.fn() });
    expect(generate).not.toHaveBeenCalled();
    expect(useBatchStore.getState().status).toBe('idle');
    expect(useBatchStore.getState().rows.map(row => row.status)).toEqual(['pending', 'pending']);

  } finally {
    await act(async () => { finish(createExportArtifact(mocks.render.mock.calls[0][0], new Blob(['pdf']))); });
    await vi.waitFor(() => expect(clearBatchExports()).toBe(true));
  }
});
