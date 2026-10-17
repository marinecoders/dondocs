import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobilePreviewModal } from '@/components/modals/MobilePreviewModal';
import { useUIStore } from '@/stores/uiStore';
vi.mock('@/components/pdf/PdfViewer', () => ({ default: () => <div>PDF page</div> }));
beforeEach(() => { useUIStore.setState({ mobilePreviewOpen: true }); });
describe('mobile preview', () => {
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
