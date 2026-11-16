import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const pdf = vi.hoisted(() => ({
  loaded: false,
  pages: [] as Array<{ onRenderSuccess(): void; onRenderError(): void }>,
  documents: [] as Array<{ onLoadError(): void }>,
}));
vi.mock('react-pdf', () => ({
  Document: (props: { children: ReactNode; loading: ReactNode; onLoadError(): void }) => {
    pdf.documents.push(props);return <div>{pdf.loaded ? props.children : props.loading}</div>;
  },
  Page: (props: { onRenderSuccess(): void; onRenderError(): void }) => {
    pdf.pages.push(props);return <canvas aria-label="Test signing page" />;
  },
}));
vi.mock('@/components/pdf/pdfConfig', () => ({ HARDENED_PDF_OPTIONS: { isEvalSupported: false } }));
import { SigningPdfPreview } from '@/components/SigningPdfPreview';

beforeEach(() => {
  pdf.loaded = false;pdf.pages = [];pdf.documents = [];
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:signing-test'), revokeObjectURL: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); });
const data = btoa('%PDF-1.7 retained source');

it('reserves the page geometry while loading and becomes ready only after canvas rendering', async () => {
  const readiness = vi.fn();
  const component = () => <SigningPdfPreview data={data} page={0} width={480} height={720} onReadiness={readiness} />;
  const view = render(component());
  await waitFor(() => expect(pdf.documents.length).toBeGreaterThan(0));
  const box = view.container.querySelector('[data-signing-preview-page]')!;
  expect(box).toHaveStyle({ width: '480px', height: '720px' });
  expect(box).toHaveAttribute('aria-busy', 'true');expect(readiness).toHaveBeenLastCalledWith(false);
  pdf.loaded = true;view.rerender(component());
  expect(screen.getByLabelText('Test signing page')).toBeInTheDocument();expect(readiness).toHaveBeenLastCalledWith(false);
  act(() => pdf.pages.at(-1)!.onRenderSuccess());
  expect(readiness).toHaveBeenLastCalledWith(true);expect(box).toHaveAttribute('aria-busy', 'false');
  expect(box).toHaveStyle({ width: '480px', height: '720px' });
  readiness.mockClear();view.rerender(component());expect(readiness).not.toHaveBeenCalled();
});

it('invalidates page/zoom approval, ignores a stale page callback and reports render failure', async () => {
  pdf.loaded = true;const readiness = vi.fn();
  const component = (page: number, width = 480) => <SigningPdfPreview data={data} page={page} width={width} height={width * 1.5} onReadiness={readiness} />;
  const view = render(component(0));await waitFor(() => expect(pdf.pages.length).toBeGreaterThan(0));
  const first = pdf.pages.at(-1)!;act(() => first.onRenderSuccess());expect(readiness).toHaveBeenLastCalledWith(true);
  view.rerender(component(1));expect(readiness).toHaveBeenLastCalledWith(false);
  act(() => first.onRenderSuccess());expect(readiness).toHaveBeenLastCalledWith(false);
  act(() => pdf.pages.at(-1)!.onRenderSuccess());expect(readiness).toHaveBeenLastCalledWith(true);
  view.rerender(component(1, 600));expect(readiness).toHaveBeenLastCalledWith(false);
  act(() => pdf.pages.at(-1)!.onRenderSuccess());expect(readiness).toHaveBeenLastCalledWith(true);
  act(() => pdf.pages.at(-1)!.onRenderError());expect(readiness).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('alert')).toHaveTextContent('page could not be rendered');
});

it('revokes readiness when document loading fails or the source is replaced', async () => {
  pdf.loaded = true;const readiness = vi.fn();
  const view = render(<SigningPdfPreview key="first" data={data} page={0} width={480} height={720} onReadiness={readiness} />);
  await waitFor(() => expect(pdf.pages.length).toBeGreaterThan(0));
  const first = pdf.pages.at(-1)!;act(() => first.onRenderSuccess());expect(readiness).toHaveBeenLastCalledWith(true);
  act(() => pdf.documents.at(-1)!.onLoadError());expect(readiness).toHaveBeenLastCalledWith(false);
  view.rerender(<SigningPdfPreview key="second" data={btoa('%PDF-1.7 replacement')} page={0} width={480} height={720} onReadiness={readiness} />);
  expect(readiness).toHaveBeenLastCalledWith(false);
  act(() => first.onRenderSuccess());expect(readiness).toHaveBeenLastCalledWith(false);
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
  act(() => pdf.pages.at(-1)!.onRenderSuccess());expect(readiness).toHaveBeenLastCalledWith(true);
});
