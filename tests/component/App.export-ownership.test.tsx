import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReadyExportJob } from '@/lib/preparedExport';

const mocks = vi.hoisted(() => ({ engineReady: true, render: vi.fn(), deliver: vi.fn(async () => true), release: vi.fn() }));
vi.mock('@/hooks', () => ({
  useLatexEngine: () => ({ isReady: mocks.engineReady, compile: async () => null, waitForReady: async () => true, error: null }),
  useServiceWorker: () => ({ showUpdatePrompt: false, confirmUpdate() {}, dismissUpdatePrompt() {} }),
  useInstallPrompt() {}, promptInstall() {},
}));
vi.mock('@/config/classification', async () => {
  const { resolveExportDeploymentPolicy } = await import('@/lib/exportDeploymentPolicy');
  return { getExportDeploymentPolicy: async () => resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }) };
});
vi.mock('@/services/exports/correspondence', () => ({ renderPreparedCorrespondence: mocks.render }));
vi.mock('@/utils/exportDelivery', () => ({ openBrowserExportDelivery: () => ({ deliver: mocks.deliver, release: mocks.release }) }));
vi.mock('@/services/formCatalog', () => { const catalog: never[] = [];return { useFormCatalog: () => catalog }; });
vi.mock('@/hooks/usePandocIdlePrefetch', () => ({ usePandocIdlePrefetch() {} }));
vi.mock('@/components/layout/FormPanel', () => ({ FormPanel: () => null }));
vi.mock('@/components/layout/Header', () => ({ Header: ({ onDownloadPdf }: { onDownloadPdf(): void }) => <button onClick={onDownloadPdf}>Export captured PDF</button> }));
vi.mock('@/components/modals/WelcomeModal', () => ({ WelcomeModal: () => null }));
vi.mock('@/components/layout/PreviewPanel', () => ({ PreviewPanel: () => null }));

import App from '@/App';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { copyPreparedDocument } from '@/lib/preparedExport';
import { createExportArtifact } from '@/lib/exportExecution';

beforeEach(() => {
  mocks.engineReady = true;
  mocks.render.mockReset().mockImplementation(async (ready: ReadyExportJob) => createExportArtifact(ready, new Blob(['pdf'])));
  mocks.deliver.mockReset().mockResolvedValue(true);mocks.release.mockClear();
  vi.spyOn(useDocumentsStore.getState(), 'init').mockResolvedValue(true);
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  useDocumentsStore.setState({ currentId: 'document-a', activationEpoch: 1 });
  useDocumentStore.setState({ documentMode: 'compliant', documentCategory: 'correspondence', docType: 'standard_letter',
    formData: { fontFamily: 'times', fontSize: '12pt', subject: 'ORIGINAL' }, paragraphs: [{ level: 0, text: 'SSN 123-45-6789' }],
    references: [], enclosures: [], copyTos: [], distributions: [] });
});
afterEach(() => { cleanup();vi.restoreAllMocks(); });

it('exports the reviewed revision after the editor switches to another document', async () => {
  await act(async () => { render(<App />); });
  fireEvent.click(screen.getByText('Export captured PDF'));
  const proceed = await screen.findByRole('button', { name: /download anyway/i });
  act(() => {
    useDocumentsStore.setState({ currentId: 'document-b', activationEpoch: 2 });
    useDocumentStore.setState({ formData: { subject: 'DIFFERENT' }, paragraphs: [{ level: 0, text: 'Other body' }] });
  });
  fireEvent.click(proceed);
  await vi.waitFor(() => expect(mocks.deliver).toHaveBeenCalledTimes(1));
  const ready = mocks.render.mock.calls[0][0] as ReadyExportJob;
  expect(ready.job.source.documentId).toBe('document-a');
  expect(copyPreparedDocument(ready).document.formData.subject).toBe('ORIGINAL');
  expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ job: ready.job }));
});

it('retries the approved job instead of recapturing the current editor', async () => {
  mocks.render.mockRejectedValueOnce(new Error('Worker failed'));
  await act(async () => { render(<App />); });
  fireEvent.click(screen.getByText('Export captured PDF'));
  fireEvent.click(await screen.findByRole('button', { name: /download anyway/i }));
  const retry = await screen.findByRole('button', { name: 'Retry' });
  act(() => { useDocumentStore.setState({ formData: { subject: 'DIFFERENT' } }); });
  fireEvent.click(retry);
  await vi.waitFor(() => expect(mocks.deliver).toHaveBeenCalledTimes(1));
  expect(mocks.render.mock.calls[1][0]).toBe(mocks.render.mock.calls[0][0]);
});


it('offers startup Retry promptly and retains the original captured export', async () => {
  mocks.engineReady = false;
  await act(async () => { render(<App />); });
  fireEvent.click(screen.getByText('Export captured PDF'));
  fireEvent.click(await screen.findByRole('button', { name: /download anyway/i }));
  const error = await screen.findByRole('dialog', { name: 'Engine still starting up' });
  expect(error).toBeVisible();expect(mocks.render).not.toHaveBeenCalled();
  await act(async () => { mocks.engineReady = true;useDocumentStore.getState().setField('subject', 'DIFFERENT'); });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await vi.waitFor(() => expect(mocks.deliver).toHaveBeenCalledTimes(1));
  expect(copyPreparedDocument(mocks.render.mock.calls[0][0]).document.formData.subject).toBe('ORIGINAL');
});

it('shows the captured export compiler diagnostics when rendering fails', async () => {
  const compileLog = '! Undefined control sequence.\nl.42 \\invalidcommand';
  mocks.render.mockRejectedValueOnce(Object.assign(new Error('Compilation failed'), { compileLog }));
  await act(async () => { render(<App />); });
  fireEvent.click(screen.getByText('Export captured PDF'));
  fireEvent.click(await screen.findByRole('button', { name: /download anyway/i }));
  await screen.findByRole('dialog', { name: 'PDF download failed' });
  expect(screen.getByLabelText('Error log output').textContent).toBe(compileLog);
  expect(screen.getByRole('button', { name: 'Copy log to clipboard' })).toBeVisible();
});
