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
import { useBatchStore } from '@/stores/batchStore';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
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
