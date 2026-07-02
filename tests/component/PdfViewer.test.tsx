// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// react-pdf stub: Document invokes onLoadSuccess asynchronously with a doc
// proxy; Page renders a probe div and fires onRenderSuccess after mount. This
// exercises the real swap machine, zoom math, and layer lifecycle without a
// canvas or worker (happy-dom has neither).
vi.mock('react-pdf', async () => {
  const React = await import('react');
  const PAGE_ASPECT = 8.5 / 11;
  const makeDoc = (numPages: number) => ({
    numPages,
    getPage: (n: number) =>
      Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: (612 / PAGE_ASPECT) * scale }),
        void: n,
      }),
  });
  function Document({ file, onLoadSuccess, children }: never) {
    React.useEffect(() => {
      let alive = true;
      // Two pages for every doc; async like the real parser.
      void Promise.resolve().then(() => alive && onLoadSuccess?.(makeDoc(2)));
      return () => {
        alive = false;
      };
      // Keyed on file alone on purpose: callbacks are inline in the layer and
      // change identity per render; re-firing would double-load documents.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file]);
    return React.createElement('div', { 'data-testid': `doc:${file}` }, children);
  }
  function Page({ pageNumber, width, onRenderSuccess }: never) {
    React.useEffect(() => {
      const t = setTimeout(() => onRenderSuccess?.(), 0);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement('div', { 'data-testid': `page:${pageNumber}`, 'data-width': width });
  }
  return {
    Document,
    Page,
    pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
  };
});

import PdfViewer from '@/components/pdf/PdfViewer';
import { TooltipProvider } from '@/components/ui/tooltip';

// The viewer always lives under the app-level TooltipProvider; mirror that.
function renderViewer(url: string) {
  return render(
    <TooltipProvider>
      <PdfViewer pdfUrl={url} />
    </TooltipProvider>
  );
}

beforeAll(() => {
  // happy-dom lacks ResizeObserver; the zoom hook degrades to its initial width.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

describe('PdfViewer', () => {
  it('renders the toolbar with a tabular page indicator once the doc loads', async () => {
    renderViewer('blob:test/1');
    await waitFor(() => expect(screen.getByText('of 2')).toBeTruthy());
    expect((screen.getByLabelText('Page number') as HTMLInputElement).value).toBe('1');
    expect(screen.getByLabelText('Zoom in')).toBeTruthy();
    expect(screen.getByLabelText('Open in browser tab')).toBeTruthy();
  });

  it('keeps the old document mounted until the incoming one is ready, then swaps', async () => {
    const { rerender, container } = renderViewer('blob:test/1');
    await waitFor(() => expect(container.querySelector('[data-testid="doc:blob:test/1"]')).toBeTruthy());

    rerender(
      <TooltipProvider>
        <PdfViewer pdfUrl="blob:test/2" />
      </TooltipProvider>
    );
    // Both documents exist during the staged swap (old visible, new hidden).
    await waitFor(() => expect(container.querySelector('[data-testid="doc:blob:test/2"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="doc:blob:test/1"]')).toBeTruthy();

    // After the stub pages paint, the machine promotes and the old doc leaves
    // (fade window included).
    await waitFor(
      () => {
        const active = container.querySelector('[data-pdf-layer="active"] [data-testid="doc:blob:test/2"]');
        expect(active).toBeTruthy();
      },
      { timeout: 3000 }
    );
    await waitFor(
      () => expect(container.querySelector('[data-testid="doc:blob:test/1"]')).toBeNull(),
      { timeout: 3000 }
    );
  });

  it('offers both fit modes and a direct page-number input', async () => {
    const { container } = renderViewer('blob:test/4');
    await waitFor(() => expect(container.querySelector('[data-testid="page:1"]')).toBeTruthy());

    // Two explicit fit buttons; fit-width is the resting default.
    const fitWidth = screen.getByLabelText('Fit width');
    const fitPage = screen.getByLabelText('Fit page');
    expect(fitWidth.getAttribute('aria-pressed')).toBe('true');
    expect(fitPage.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(fitPage);
    await waitFor(() => expect(fitPage.getAttribute('aria-pressed')).toBe('true'));
    expect(fitWidth.getAttribute('aria-pressed')).toBe('false');

    // Page input seeds from the current page and clamps invalid entries back.
    const input = screen.getByLabelText('Page number') as HTMLInputElement;
    expect(input.value).toBe('1');
    fireEvent.keyDown(input, { key: 'Enter', target: input }); // unchanged → no-op
    input.value = '99';
    fireEvent.blur(input);
    expect(input.value).toBe('1'); // out of range for a 2-page doc → restored

    // A valid entry actually scrolls the active layer to that page's band.
    const scrollCalls: Array<{ top?: number }> = [];
    (Element.prototype as { scrollTo: (o: { top?: number }) => void }).scrollTo = function (o) {
      scrollCalls.push(o);
    };
    input.value = '2';
    fireEvent.keyDown(input, { key: 'Enter', target: input });
    expect(scrollCalls.length).toBeGreaterThan(0);
    expect(scrollCalls[scrollCalls.length - 1].top).toBeGreaterThan(0); // page 2 sits below page 1
  });

  it('thumbnail rail: toggle appears on multi-page docs, opens a clickable rail', async () => {
    const { container } = renderViewer('blob:test/5');
    await waitFor(() => expect(screen.getByText('of 2')).toBeTruthy());

    const toggle = screen.getByLabelText('Show page thumbnails');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);

    // Rail mounts and the portal fills it with one thumbnail button per page,
    // drawn from the SAME document (no second doc:testid appears).
    await waitFor(() => expect(screen.getByLabelText('Go to page 2')).toBeTruthy());
    expect(container.querySelectorAll('[data-testid="doc:blob:test/5"]')).toHaveLength(1);
    expect(screen.getByLabelText('Go to page 1').getAttribute('aria-current')).toBe('page');
    expect(screen.getByLabelText('Hide page thumbnails').getAttribute('aria-pressed')).toBe('true');

    // Close restores the clean single-column layout.
    fireEvent.click(screen.getByLabelText('Hide page thumbnails'));
    await waitFor(() => expect(screen.queryByLabelText('Go to page 2')).toBeNull());
  });

  it('zoom buttons change the rendered page width', async () => {
    const { container } = renderViewer('blob:test/3');
    await waitFor(() => expect(container.querySelector('[data-testid="page:1"]')).toBeTruthy());
    const before = Number(container.querySelector('[data-testid="page:1"]')!.getAttribute('data-width'));

    fireEvent.click(screen.getByLabelText('Zoom in'));
    await waitFor(() => {
      const after = Number(container.querySelector('[data-testid="page:1"]')!.getAttribute('data-width'));
      expect(after).toBeGreaterThan(before);
    });
  });
});
