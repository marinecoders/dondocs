import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReadyExportJob } from '@/lib/preparedExport';

const mocks = vi.hoisted(() => ({ engineReady: true, render: vi.fn(), renderConfigured: vi.fn(), renderForm: vi.fn(), loadPage: vi.fn(), deliver: vi.fn(async () => true), release: vi.fn() }));
vi.mock('@/hooks', () => ({
  useLatexEngine: () => ({ isReady: mocks.engineReady, compile: async () => null, waitForReady: async () => true, error: null }),
  useServiceWorker: () => ({ showUpdatePrompt: false, confirmUpdate() {}, dismissUpdatePrompt() {} }),
  useInstallPrompt() {}, promptInstall() {},
}));
vi.mock('@/config/classification', async () => {
  const { resolveExportDeploymentPolicy } = await import('@/lib/exportDeploymentPolicy');
  return { getExportDeploymentPolicy: async () => resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }) };
});
vi.mock('@/services/exports/configuredForms', () => ({ renderPreparedConfiguredForm: mocks.renderConfigured }));
vi.mock('@/services/forms/packages', () => ({ loadPackagePage: mocks.loadPage }));
vi.mock('@/services/forms/render', () => ({ renderForm: async () => ({ bytes: new Uint8Array([1]), diagnostics: [] }) }));
vi.mock('@/services/exports/correspondence', () => ({ renderPreparedCorrespondence: mocks.render }));
vi.mock('@/services/exports/builtinForms', () => ({ renderPreparedBuiltinForm: mocks.renderForm }));
vi.mock('@/services/exports/formTemplates', async original => {
  const actual = await original<typeof import('@/services/exports/formTemplates')>();
  const { captureFormExportTemplates } = await import('@/lib/formExportTemplates');
  const { copyCapturedDocument } = await import('@/lib/capturedDocument');
  return { captureExportFormTemplates: async (captured: Parameters<typeof copyCapturedDocument>[0]) => {
    const content = copyCapturedDocument(captured);
    return content.kind === 'builtin-form'
      ? captureFormExportTemplates('builtin-form', content.document.formType, { page1: new Uint8Array([1]), page2: new Uint8Array([2]), page3: new Uint8Array([3]) }) : actual.captureExportFormTemplates(captured);
  } };
});
vi.mock('@/utils/exportDelivery', () => ({ openBrowserExportDelivery: () => ({ deliver: mocks.deliver, release: mocks.release }) }));
vi.mock('@/services/formCatalog', () => { const catalog: never[] = [];return { useFormCatalog: () => catalog }; });
vi.mock('@/hooks/usePandocIdlePrefetch', () => ({ usePandocIdlePrefetch() {} }));
vi.mock('@/components/layout/FormPanel', () => ({ FormPanel: () => null }));
vi.mock('@/components/layout/Header', () => ({ Header: ({ onDownloadPdf, onDownloadTex, onDownloadFlatTex }: Record<string, () => void>) => <>
  <button onClick={onDownloadPdf}>Export captured PDF</button>
  <button onClick={onDownloadTex}>Export captured TeX</button>
  <button onClick={onDownloadFlatTex}>Export captured flat TeX</button>
</> }));
vi.mock('@/components/modals/WelcomeModal', () => ({ WelcomeModal: () => null }));
vi.mock('@/components/layout/PreviewPanel', () => ({ PreviewPanel: () => null }));

import App from '@/App';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { copyPreparedDocument, copyPreparedFormTemplates } from '@/lib/preparedExport';
import { createExportArtifact } from '@/lib/exportExecution';
import { useFormStore } from '@/stores/formStore';

beforeEach(() => {
  mocks.engineReady = true;
  mocks.render.mockReset().mockImplementation(async (ready: ReadyExportJob) => createExportArtifact(ready, new Blob(['pdf'])));
  mocks.renderConfigured.mockReset().mockImplementation(async (ready: ReadyExportJob) => createExportArtifact(ready, new Blob(['form'])));
  mocks.loadPage.mockReset();
  mocks.renderForm.mockReset().mockImplementation(async (ready: ReadyExportJob) => createExportArtifact(ready, new Blob(['pdf'])));
  mocks.deliver.mockReset().mockResolvedValue(true);mocks.release.mockClear();
  vi.spyOn(useDocumentsStore.getState(), 'init').mockResolvedValue(true);
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  useDocumentsStore.setState({ currentId: 'document-a', activationEpoch: 1 });
  useDocumentStore.setState({ documentMode: 'compliant', documentCategory: 'correspondence', docType: 'standard_letter',
    genericForm: undefined, formType: 'navmc_10274',
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

it('reviews and retries the captured configured form without waiting for the LaTeX engine', async () => {
  mocks.engineReady = false;
  const form = fixtureInstance();
  const page = await fixturePage();
  form.definition.pages[0].sha256 = page.sha256;
  form.answers.name = 'SSN 123-45-6789';
  mocks.loadPage.mockResolvedValue(page.bytes);
  mocks.renderConfigured.mockRejectedValueOnce(new Error('Form render failed'));
  useDocumentStore.setState({ documentCategory: 'forms', formType: 'fixture', genericForm: form });
  await act(async () => { render(<App />); });
  const sourceId = useDocumentsStore.getState().currentId;
  expect(sourceId).toBeTruthy();
  fireEvent.click(screen.getByText('Export captured PDF'));
  const proceed = await screen.findByRole('button', { name: /download anyway/i });
  act(() => {
    useDocumentsStore.setState({ currentId: 'document-b', activationEpoch: 2 });
    useDocumentStore.setState({ genericForm: { ...form, answers: { ...form.answers, name: 'DIFFERENT' } } });
  });
  fireEvent.click(proceed);
  const retry = await screen.findByRole('button', { name: 'Retry' });
  const ready = mocks.renderConfigured.mock.calls[0][0] as ReadyExportJob;
  expect(ready.job.source.documentId).toBe(sourceId);
  expect(ready.job.source.documentId).not.toBe('document-b');
  expect(ready.job.filename).toBe('fixture-form.pdf');
  expect(copyPreparedDocument(ready).document.genericForm?.answers.name).toBe('SSN 123-45-6789');
  const retained = copyPreparedFormTemplates(ready)['page1.pdf'];
  page.bytes.fill(0);
  fireEvent.click(retry);
  await vi.waitFor(() => expect(mocks.deliver).toHaveBeenCalledTimes(1));
  expect(mocks.renderConfigured.mock.calls[1][0]).toBe(ready);
  expect(copyPreparedFormTemplates(ready)['page1.pdf']).toEqual(retained);
  expect(mocks.loadPage).toHaveBeenCalledTimes(1);
  expect(mocks.render).not.toHaveBeenCalled();
});

it.each(['TeX', 'flat TeX'])('reviews actual %s download requests before rendering and delivery', async mode => {
  await act(async () => { render(<App />); });
  fireEvent.click(screen.getByRole('button', { name: `Export captured ${mode}` }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(mocks.render).not.toHaveBeenCalled();expect(mocks.deliver).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: `Export captured ${mode}` }));
  fireEvent.click(await screen.findByRole('button', { name: 'Download Anyway' }));
  await vi.waitFor(() => expect(mocks.deliver).toHaveBeenCalledOnce());
  expect(mocks.render.mock.calls[0][0].job).toMatchObject({ target: 'tex', texMode: mode === 'TeX' ? 'configuration' : 'flat' });
});

it('exports an ordinary dedicated Page 11 EDIPI through App without a privacy warning', async () => {
  useDocumentStore.setState({ documentCategory: 'forms', formType: 'navmc_118_11' });
  useFormStore.setState({ navmc11811: { ...useFormStore.getInitialState().navmc11811, edipi: '1436758291', remarksText: '', signatureBlocks: [] } });
  await act(async () => { render(<App />); });
  fireEvent.click(screen.getByRole('button', { name: 'Export captured PDF' }));
  await vi.waitFor(() => expect(mocks.renderForm, screen.queryAllByRole('dialog').map(dialog => dialog.textContent).join('\n')).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(mocks.deliver).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button', { name: 'Download Anyway' })).not.toBeInTheDocument();
  expect(copyPreparedDocument(mocks.renderForm.mock.calls[0][0]).document.forms?.navmc11811?.edipi).toBe('1436758291');
});

it.each(['navmc_10274', 'navmc_118_11'] as const)('reviews %s free-text IDs through App before rendering', async formType => {
  useDocumentStore.setState({ documentCategory: 'forms', formType });
  useFormStore.setState({
    navmc10274: { ...useFormStore.getInitialState().navmc10274, from: 'Sample 1436758291/0311' },
    navmc11811: { ...useFormStore.getInitialState().navmc11811, edipi: '1436758291', remarksTextRight: 'ID {{EDIPI}}' },
  });
  await act(async () => { render(<App />); });
  fireEvent.click(screen.getByRole('button', { name: 'Export captured PDF' }));
  const proceed = await screen.findByRole('button', { name: 'Download Anyway' });
  expect(mocks.renderForm).not.toHaveBeenCalled();expect(mocks.deliver).not.toHaveBeenCalled();
  fireEvent.click(proceed);
  await vi.waitFor(() => expect(mocks.renderForm).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(mocks.deliver).toHaveBeenCalledOnce());
});
