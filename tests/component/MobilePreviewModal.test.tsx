import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobilePreviewModal } from '@/components/modals/MobilePreviewModal';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
vi.mock('@/components/pdf/PdfViewer', () => ({ default: ({ onDownloadPdf, allowOpenInTab, sourceNavigationMessage }: { onDownloadPdf?: () => void; allowOpenInTab?: boolean; sourceNavigationMessage?: string }) => <div>PDF page{sourceNavigationMessage && <p>{sourceNavigationMessage}</p>}{onDownloadPdf && <button onClick={onDownloadPdf}>Download PDF</button>}{allowOpenInTab && <button>Open PDF</button>}</div> }));
beforeEach(() => { useUIStore.setState({ mobilePreviewOpen: true }); });
describe('mobile preview', () => {
  it('withholds delivery during an engine reset without exposing the internal signal', () => {
    render(<MobilePreviewModal pdfUrl="blob:previous" isCompiling={false} error="ENGINE_RESET_NEEDED" onDownloadPdf={vi.fn()} />);
    expect(screen.getByText('PDF page')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Download/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open PDF' })).toBeNull();
    expect(screen.queryByText(/ENGINE_RESET_NEEDED/)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Updating preview');
  });
  it('retains the last preview during compilation and exposes stale errors', () => {
    const props = { pdfUrl: 'blob:preview', isCompiling: false, error: null as string | null, onDownloadPdf: vi.fn() };
    const { rerender } = render(<MobilePreviewModal {...props} />);
    const page = screen.getByText('PDF page');
    rerender(<MobilePreviewModal {...props} isCompiling />);
    expect(screen.getByText('PDF page')).toBe(page);
    expect(screen.getByRole('status')).toHaveTextContent('Updating preview');
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open PDF' })).toBeNull();
    rerender(<MobilePreviewModal {...props} error="Broken reference" />);
    expect(screen.getByText('PDF page')).toBe(page);
    expect(screen.getByRole('alert')).toHaveTextContent('Broken reference');
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
    rerender(<MobilePreviewModal {...props} />);
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
  });
  it('downloads through the complete export action, not the displayed preview bytes', () => {
    const download = vi.fn();
    render(<MobilePreviewModal pdfUrl="blob:preview" isCompiling={false} error={null} onDownloadPdf={download} />);
    expect(screen.getByRole('dialog', { name: 'PDF preview' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(download).toHaveBeenCalledOnce();
    expect(useUIStore.getState().mobilePreviewOpen).toBe(false);
  });
  it('does not offer a stale preview as a downloadable final document', () => {
    render(<MobilePreviewModal pdfUrl="blob:stale" isCompiling={false} error="Generation failed" onDownloadPdf={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close preview' })).toBeInTheDocument();
  });
});

it('explains limited source navigation on mobile without disabling PDF delivery', () => {
  useUIStore.setState({ isMobile: true });
  useDocumentStore.setState({ docType: 'naval_letter', documentCategory: 'correspondence', enclosures: [],
    paragraphs: Array.from({ length: 513 }, (_, index) => ({ id: `large-${index}`, level: 0, text: `Unique source paragraph ${index}.` })) });
  render(<MobilePreviewModal pdfUrl="blob:large" isCompiling={false} error={null} onDownloadPdf={vi.fn()} />);
  expect(screen.getByText('Source navigation is unavailable for this large document.')).toBeVisible();
  expect(screen.getByRole('button', { name: /^Download$/ })).toBeEnabled();
});
