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
import { useDocumentStore, mutateSessionAssets } from '@/stores/documentStore';
import { useDocumentsStore, captureDocumentTarget, isCurrentDocumentTarget } from '@/stores/documentsStore';
import { useFormStore } from '@/stores/formStore';
import { useUIStore } from '@/stores/uiStore';
import * as updateCheckpoint from '@/lib/updateCheckpoint';

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

it('excludes inactive publication figures and markings from a letter preview', async () => {
  useDocumentStore.setState({ formData: { subject: 'Active letter', classLevel: 'unclassified' }, paragraphs: [{ level: 0, text: 'Visible body', figure: { fileRef: { id: 'missing-inactive', name: 'old.png', type: 'image/png', size: 3 }, portionMarking: 'S' } }] });
  await act(async () => { render(<App />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(compile).toHaveBeenCalledTimes(1);
  const files = compile.mock.calls[0][0];
  expect(files['body.tex']).toContain('Visible body');
  expect(files['classification.tex']).not.toContain('SECRET');
  expect(Object.keys(files).some(name => name.includes('figure'))).toBe(false);
});

it('owns captured built-in form values and cached template bytes during preview rendering', async () => {
  const templates = { page1: new Uint8Array([2]).buffer, page2: new Uint8Array([3]).buffer, page3: new Uint8Array([4]).buffer };
  load10274.mockResolvedValue(templates);
  useDocumentsStore.getState().newDocument('navmc_10274');
  useFormStore.getState().setNavmc10274Field('from', 'CAPTURED SOURCE');
  generate10274.mockImplementationOnce(async (data, page1, page2, page3) => {
    expect(data.from).toBe('CAPTURED SOURCE');
    data.from = 'RENDERER MUTATION';
    new Uint8Array(page1)[0] = 9;
    new Uint8Array(page2)[0] = 9;
    new Uint8Array(page3)[0] = 9;
    return new Uint8Array([1]);
  });
  await act(async () => { render(<App />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(generate10274).toHaveBeenCalledTimes(1);
  expect(useFormStore.getState().navmc10274.from).toBe('CAPTURED SOURCE');
  expect([new Uint8Array(templates.page1)[0], new Uint8Array(templates.page2)[0], new Uint8Array(templates.page3)[0]]).toEqual([2,3,4]);
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'false');
});

it('drops a built-in form generation result edited before React effects flush', async () => {
  let finish!: (data: Uint8Array) => void;
  generate11811.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  useDocumentsStore.getState().newDocument('navmc_118_11');
  const urls = vi.spyOn(URL, 'createObjectURL'); urls.mockClear();
  await act(async () => { render(<App />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(generate11811).toHaveBeenCalledTimes(1);
  await act(async () => {
    useFormStore.getState().setNavmc11811Field('lastName', 'LATEST');
    finish(new Uint8Array([1]));
    for(let i=0;i<10;i++) await Promise.resolve();
  });
  expect(urls).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(generate11811).toHaveBeenCalledTimes(2);
  expect(generate11811.mock.calls[1][0].lastName).toBe('LATEST');
  expect(urls).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'false');
});


it('keeps explicit form refresh busy and blocks updates until its owned render finishes', async () => {
  const guards = vi.spyOn(updateCheckpoint, 'registerUpdateGuard');
  useDocumentsStore.getState().newDocument('navmc_118_11');
  await act(async () => { render(<App />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'false');
  let finish!: (bytes: Uint8Array) => void;
  generate11811.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' })); });
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'true');
  expect(() => guards.mock.calls.at(-1)![0]()).toThrow('Finish document generation');
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(generate11811).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'true');
  expect(() => guards.mock.calls.at(-1)![0]()).toThrow('Finish document generation');
  await act(async () => { finish(new Uint8Array([2])); });
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'false');
  expect(() => guards.mock.calls.at(-1)![0]()).not.toThrow();
});

it('regenerates after passive form asset hydration and returns to idle without invalidating the editor target', async () => {
  const guards = vi.spyOn(updateCheckpoint, 'registerUpdateGuard');
  useDocumentsStore.getState().newDocument('navmc_10274');
  await act(async () => { render(<App />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'false');
  const target = captureDocumentTarget();
  let finish!: (bytes: Uint8Array) => void;
  generate10274.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => {
    mutateSessionAssets(() => useFormStore.setState(state => ({ navmc10274: { ...state.navmc10274,
      signatureBlocks: [{ name: 'SIGNER', statement: '', style: 'image', image: 'data:image/png;base64,AQID' }] } })));
  });
  expect(isCurrentDocumentTarget(target)).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'true');
  expect(generate10274).toHaveBeenCalledTimes(2);
  expect(generate10274.mock.calls[1][0].signatureBlocks[0].image).toBe('data:image/png;base64,AQID');
  expect(() => guards.mock.calls.at(-1)![0]()).toThrow('Finish document generation');
  await act(async () => { finish(new Uint8Array([2])); });
  expect(isCurrentDocumentTarget(target)).toBe(true);
  expect(screen.getByTestId('preview-state')).toHaveAttribute('data-compiling', 'false');
  expect(() => guards.mock.calls.at(-1)![0]()).not.toThrow();
});

it('closes an earlier compile error only after the current retry succeeds', async () => {
  compile.mockRejectedValueOnce(new Error('Figure 1 has no image. Choose a PNG or JPEG before exporting.'));
  await act(async () => { render(<App />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(screen.getByRole('dialog', { name: 'Preview compile failed' })).toBeVisible();

  let finish!: (bytes: Uint8Array) => void;
  compile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => { useDocumentStore.getState().setField('subject', 'RECOVERED PREVIEW'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
  expect(screen.getByRole('dialog', { name: 'Preview compile failed' })).toBeVisible();

  await act(async () => { finish(new Uint8Array([1, 2, 3])); });
  expect(screen.queryByRole('dialog', { name: 'Preview compile failed' })).not.toBeInTheDocument();
  expect(screen.getByTestId('preview-state')).toHaveTextContent('Ready');
});
