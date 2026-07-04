// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Same react-pdf stub as PdfViewer.test — the panel lazy-loads the viewer.
vi.mock('react-pdf', async () => {
  const React = await import('react');
  const makeDoc = (numPages: number) => ({
    numPages,
    getPage: () =>
      Promise.resolve({ getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }) }),
  });
  function Document({ file, onLoadSuccess, children }: never) {
    React.useEffect(() => {
      let alive = true;
      void Promise.resolve().then(() => alive && onLoadSuccess?.(makeDoc(1)));
      return () => {
        alive = false;
      };
      // Keyed on file alone on purpose — see PdfViewer.test.tsx.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file]);
    return React.createElement('div', { 'data-testid': `doc:${file}` }, children);
  }
  function Page({ pageNumber, onRenderSuccess }: never) {
    React.useEffect(() => {
      const t = setTimeout(() => onRenderSuccess?.(), 0);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement('div', { 'data-testid': `page:${pageNumber}` });
  }
  return { Document, Page, pdfjs: { GlobalWorkerOptions: {}, version: 'test' } };
});

import { PreviewPanel } from '@/components/layout/PreviewPanel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores/uiStore';

function renderPanel(props: Partial<React.ComponentProps<typeof PreviewPanel>>) {
  return render(
    <TooltipProvider>
      <PreviewPanel pdfUrl={null} isCompiling={false} error={null} {...props} />
    </TooltipProvider>
  );
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

beforeEach(() => {
  // Desktop panel path, preview open.
  useUIStore.setState({ isMobile: false, previewVisible: true });
});

// The viewer is lazy-loaded (React.lazy), so the `doc:` node only mounts after
// the dynamic import resolves. Under a saturated CI/parallel test pool that can
// take longer than waitFor's 1s default, which flaked these waits; a generous
// ceiling removes the race without slowing the happy path (waitFor still returns
// the instant the node appears).
const LAZY_TIMEOUT = { timeout: 5000 };

describe('PreviewPanel — compile-error reporting', () => {
  it('a failure AFTER a successful compile banners over the stale document', async () => {
    renderPanel({ pdfUrl: 'blob:test/ok', error: 'Undefined control sequence \\badmacro' });

    // The banner announces the failure (role=alert reaches screen readers)…
    const alert = await screen.findByRole('alert', undefined, LAZY_TIMEOUT);
    expect(alert.textContent).toContain('Compile failed — preview is out of date');
    expect(alert.textContent).toContain('Undefined control sequence');

    // …while the last good document stays visible underneath, not blanked.
    await waitFor(() => expect(screen.getByTestId('doc:blob:test/ok')).toBeTruthy(), LAZY_TIMEOUT);
  });

  it('a failure with NO document yet shows the centered error state', () => {
    renderPanel({ pdfUrl: null, error: 'Emergency stop: LaTeX exited abnormally' });
    expect(screen.getByText('Emergency stop: LaTeX exited abnormally')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull(); // no stale doc → no overlay banner
  });

  it('the internal ENGINE_RESET_NEEDED signal is never shown to the user', () => {
    renderPanel({ pdfUrl: null, error: 'ENGINE_RESET_NEEDED' });
    expect(screen.queryByText(/ENGINE_RESET_NEEDED/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('no error, no banner — the viewer renders clean', async () => {
    renderPanel({ pdfUrl: 'blob:test/clean' });
    await waitFor(() => expect(screen.getByTestId('doc:blob:test/clean')).toBeTruthy(), LAZY_TIMEOUT);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
