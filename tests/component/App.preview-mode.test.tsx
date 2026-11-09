import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { compile, load10274, load11811, generate10274, generate11811 } = vi.hoisted(() => ({
  compile: vi.fn<(files: Record<string, string | Uint8Array>) => Promise<Uint8Array | null>>().mockResolvedValue(null),
  load10274: vi.fn(), load11811: vi.fn(), generate10274: vi.fn(), generate11811: vi.fn(),
}));

// Exercise App's real store subscriptions and debounce. The PDF engine is the
// boundary: its generated files reveal which mode the preview actually used.
vi.mock('@/hooks', () => ({
  useLatexEngine: () => ({ isReady: true, compile, waitForReady: async () => {}, error: null }),
  useServiceWorker: () => ({ showUpdatePrompt: false, confirmUpdate() {}, dismissUpdatePrompt() {} }),
  useInstallPrompt() {},
  promptInstall() {},
}));
vi.mock('@/services/formCatalog', () => {
  const catalog: never[] = [];
  return { useFormCatalog: () => catalog };
});
vi.mock('@/hooks/usePandocIdlePrefetch', () => ({ usePandocIdlePrefetch() {} }));
vi.mock('@/components/layout/FormPanel', () => ({ FormPanel: () => null }));
vi.mock('@/components/layout/Header', () => ({
  Header: ({ onRefreshPreview }: { onRefreshPreview?: () => void }) => <button onClick={onRefreshPreview}>Refresh preview</button>,
}));
vi.mock('@/components/modals/WelcomeModal', () => ({ WelcomeModal: () => null }));
vi.mock('@/components/layout/PreviewPanel', () => ({
  PreviewPanel: ({ pdfUrl, isCompiling, error }: { pdfUrl: string | null; isCompiling: boolean; error: string | null }) =>
    <output aria-label="Form preview state" data-testid="preview-state" data-compiling={isCompiling}>{error ?? (pdfUrl ? 'Ready' : isCompiling ? 'Generating' : 'Idle')}</output>,
}));
vi.mock('@/services/pdf/navmc10274Generator', () => ({ loadNavmc10274Templates: load10274, generateNavmc10274Pdf: generate10274 }));
vi.mock('@/services/pdf/navmc11811Generator', () => ({ loadNavmc11811Template: load11811, generateNavmc11811Pdf: generate11811 }));

import App from '@/App';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import { useUIStore } from '@/stores/uiStore';

beforeEach(() => {
  vi.useFakeTimers();
  compile.mockReset().mockResolvedValue(null);
  load10274.mockReset().mockResolvedValue({ page1: new ArrayBuffer(1), page2: new ArrayBuffer(1), page3: new ArrayBuffer(1) });
  load11811.mockReset().mockResolvedValue(new ArrayBuffer(1));
  generate10274.mockReset().mockResolvedValue(new Uint8Array([1]));
  generate11811.mockReset().mockResolvedValue(new Uint8Array([1]));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:form-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  useDocumentsStore.getState().newDocument();
  useUIStore.setState({ isMobile: false, previewVisible: true });
  vi.spyOn(useDocumentsStore.getState(), 'init').mockResolvedValue(true);
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  useDocumentStore.setState({
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'standard_letter',
    formData: { fontFamily: 'times', fontSize: '12pt', subject: 'TYPOGRAPHY TEST' },
    paragraphs: [{ level: 0, text: 'Execution. Approval.' }],
    references: [], enclosures: [], copyTos: [], distributions: [],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('preview recompilation on format-mode changes', () => {
  it('rebuilds when only compliant/custom mode changes, using the selected mode', async () => {
    // Settle workspace hydration before advancing the preview debounce.
    await act(async () => { render(<App />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(compile).toHaveBeenCalled();
    compile.mockReset().mockResolvedValue(null);

    const fields = useDocumentStore.getState().formData;
    act(() => { useDocumentStore.getState().setDocumentMode('custom'); });
    // This transition deliberately does not create a new formData object.
    expect(useDocumentStore.getState().formData).toBe(fields);
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile.mock.calls[0][0]['document.tex']).toContain('\\setPageNumberStyle{none}');

    compile.mockReset().mockResolvedValue(null);
    act(() => { useDocumentStore.getState().setDocumentMode('compliant'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile.mock.calls[0][0]['document.tex']).toContain('\\setPageNumberStyle{simple}');
  });
});

describe('form template loading recovery', () => {
  it.each(['navmc_10274', 'navmc_118_11'] as const)('keeps a %s load failure visible past the preview debounce and retries on refresh', async formType => {
    const load = formType === 'navmc_10274' ? load10274 : load11811;
    load.mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
    useDocumentsStore.getState().newDocument(formType);
    await act(async () => { render(<App />); });
    const preview = screen.getByLabelText('Form preview state');
    expect(preview).toHaveTextContent('Could not load the NAVMC');
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(preview).toHaveTextContent('Could not load the NAVMC');
    expect(formType === 'navmc_10274' ? generate10274 : generate11811).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(load).toHaveBeenCalledTimes(2);
    expect(preview).toHaveTextContent('Ready');
  });

  it('does not show a failed previous form load after navigating to another form', async () => {
    let rejectOld!: (error: Error) => void;
    load10274.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    useDocumentsStore.getState().newDocument('navmc_10274');
    await act(async () => { render(<App />); });
    await act(async () => { useDocumentsStore.getState().newDocument('navmc_118_11'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    const preview = screen.getByLabelText('Form preview state');
    expect(preview).toHaveTextContent('Ready');
    await act(async () => { rejectOld(new Error('Old template request failed')); });
    expect(preview).toHaveTextContent('Ready');
  });
});

it('discards a worker result when the document is edited before React flushes the next effect', async () => {
  let finish!: (pdf: Uint8Array) => void;
  compile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const urls = vi.spyOn(URL, 'createObjectURL');urls.mockClear();
  await act(async () => { render(<App />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(compile).toHaveBeenCalledTimes(1);
  await act(async () => {
    useDocumentStore.getState().setField('subject', 'NEW REVISION');
    finish(new Uint8Array([1, 2, 3]));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  expect(urls).not.toHaveBeenCalled();
});

it('discards output from a previous activation of the same document ID', async () => {
  let finish!: (pdf: Uint8Array) => void;
  compile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const urls = vi.spyOn(URL, 'createObjectURL');urls.mockClear();
  await act(async () => { render(<App />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(compile).toHaveBeenCalledTimes(1);
  await act(async () => {
    useDocumentsStore.setState(state => ({ activationEpoch: state.activationEpoch + 1 }));
    finish(new Uint8Array([1, 2, 3]));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  expect(urls).not.toHaveBeenCalled();
});

it.each(['navmc_10274', 'navmc_118_11'] as const)('reports %s template failures after editing the active form', async (formType) => {
  let fail!: (error: Error) => void;
  const loader = formType === 'navmc_10274' ? load10274 : load11811;
  loader.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  useDocumentsStore.getState().newDocument(formType);
  await act(async () => { render(<App />); });
  expect(loader).toHaveBeenCalledTimes(1);

  act(() => {
    if (formType === 'navmc_10274') useFormStore.getState().setNavmc10274Field('from', 'EDITED WHILE LOADING');
    else useFormStore.getState().setNavmc11811Field('lastName', 'EDITED WHILE LOADING');
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  await act(async () => { fail(new Error('Template unavailable')); });

  expect(screen.getByTestId('preview-state')).toHaveTextContent('Could not load the NAVMC');
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'false');
  expect(loader).toHaveBeenCalledTimes(1);
});

it.each(['navmc_10274', 'navmc_118_11'] as const)('discards %s template failures from a previous document activation', async (formType) => {
  let fail!: (error: Error) => void;
  const loader = formType === 'navmc_10274' ? load10274 : load11811;
  loader.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  useDocumentsStore.getState().newDocument(formType);
  await act(async () => { render(<App />); });

  await act(async () => {
    useDocumentsStore.setState(state => ({ activationEpoch: state.activationEpoch + 1 }));
    fail(new Error('Previous activation failed'));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

  expect(screen.getByTestId('preview-state')).not.toHaveTextContent('Could not load the NAVMC');
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'true');
});
