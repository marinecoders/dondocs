import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const { compile } = vi.hoisted(() => ({
  compile: vi.fn<(files: Record<string, string | Uint8Array>) => Promise<Uint8Array | null>>().mockResolvedValue(null),
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
vi.mock('@/components/layout/Header', () => ({ Header: () => null }));
vi.mock('@/components/modals/WelcomeModal', () => ({ WelcomeModal: () => null }));
vi.mock('@/components/layout/PreviewPanel', () => ({ PreviewPanel: () => null }));

import App from '@/App';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';

beforeEach(() => {
  vi.useFakeTimers();
  compile.mockReset().mockResolvedValue(null);
  useDocumentsStore.setState({ currentId: 'preview-source', activationEpoch: 1 });
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
    compile.mockClear();

    const fields = useDocumentStore.getState().formData;
    act(() => { useDocumentStore.getState().setDocumentMode('custom'); });
    // This transition deliberately does not create a new formData object.
    expect(useDocumentStore.getState().formData).toBe(fields);
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile.mock.calls[0][0]['document.tex']).toContain('\\setPageNumberStyle{none}');

    compile.mockClear();
    act(() => { useDocumentStore.getState().setDocumentMode('compliant'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile.mock.calls[0][0]['document.tex']).toContain('\\setPageNumberStyle{simple}');
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
    useDocumentsStore.setState({ activationEpoch: 2 });
    finish(new Uint8Array([1, 2, 3]));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  expect(urls).not.toHaveBeenCalled();
});
