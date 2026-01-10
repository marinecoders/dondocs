import { useState, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { X, Loader2, AlertCircle, ScrollText, Share, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { useLogStore } from '@/stores/logStore';

// Configure pdf.js worker - use cdnjs which has better compatibility
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface MobilePreviewModalProps {
  pdfUrl: string | null;
  isCompiling: boolean;
  error: string | null;
  onDownloadPdf?: () => void;
}

export function MobilePreviewModal({ pdfUrl, isCompiling, error }: MobilePreviewModalProps) {
  const { mobilePreviewOpen, setMobilePreviewOpen } = useUIStore();
  const { setOpen: setLogViewerOpen, setEnabled: setLogEnabled } = useLogStore();
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pdfLoading, setPdfLoading] = useState<boolean>(true);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState<boolean>(false);

  // Detect if we should use fallback mode (iPad has issues with react-pdf)
  useEffect(() => {
    const isIPad = /iPad/i.test(navigator.userAgent) ||
      (/Macintosh/i.test(navigator.userAgent) && 'ontouchstart' in window);
    if (isIPad) {
      console.log('[MobilePreview] iPad detected, using fallback mode');
      setUseFallback(true);
    }
  }, []);

  // Reset state when modal opens or pdfUrl changes
  useEffect(() => {
    if (mobilePreviewOpen && pdfUrl) {
      setPdfLoading(true);
      setPdfError(null);
      setCurrentPage(1);
    }
  }, [mobilePreviewOpen, pdfUrl]);

  // Filter out engine reset message - it's not a user-facing error
  const displayError = error === 'ENGINE_RESET_NEEDED' ? null : error;

  const handleOpenLogs = () => {
    setLogEnabled(true);
    setLogViewerOpen(true);
  };

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setCurrentPage(1);
    setPdfLoading(false);
    setPdfError(null);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    console.error('PDF load error:', err);
    setPdfLoading(false);
    setPdfError('Failed to load PDF preview');
  }, []);

  const goToPrevPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  };

  const goToNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, numPages));
  };

  // Save PDF using share API or fallback
  const handleSavePdf = async () => {
    if (!pdfUrl) return;

    try {
      const response = await fetch(pdfUrl);
      const blob = await response.blob();

      // Try Web Share API first
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], 'correspondence.pdf', { type: 'application/pdf' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Naval Correspondence',
          });
          setShareStatus('Saved!');
          setTimeout(() => setShareStatus(null), 2000);
          return;
        }
      }

      // Fallback: open blob URL
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      setShareStatus('Opened - use share to save');
      setTimeout(() => setShareStatus(null), 3000);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Save failed:', err);
        setShareStatus('Error saving');
        setTimeout(() => setShareStatus(null), 3000);
      }
    }
  };

  if (!mobilePreviewOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0">
        <span className="font-semibold text-sm">Document Preview</span>
        <div className="flex items-center gap-1">
          {pdfUrl && !isCompiling && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSavePdf}
              className="h-8 px-2"
            >
              <Share className="h-4 w-4 mr-1" />
              Save
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleOpenLogs}
          >
            <ScrollText className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMobilePreviewOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Status message */}
      {shareStatus && (
        <div className="bg-primary/10 text-primary text-xs text-center py-1 shrink-0">
          {shareStatus}
        </div>
      )}

      {/* PDF Content */}
      <div className="flex-1 overflow-auto bg-muted/30">
        {/* Loading State */}
        {isCompiling && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative">
              <FileText className="h-16 w-16 text-muted-foreground/30" />
              <Loader2 className="h-8 w-8 animate-spin text-primary absolute -bottom-1 -right-1 bg-background rounded-full p-1" />
            </div>
            <div className="text-center">
              <p className="font-medium">Generating PDF...</p>
              <p className="text-sm text-muted-foreground mt-1">This may take a moment</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {displayError && !pdfUrl && !isCompiling && (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-4">
            <AlertCircle className="h-16 w-16 text-destructive/70" />
            <div className="text-center">
              <p className="font-medium text-destructive">Compilation Error</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">{displayError}</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleOpenLogs}>
              <ScrollText className="h-4 w-4 mr-2" />
              View Logs
            </Button>
          </div>
        )}

        {/* PDF Viewer - Fallback mode for iPad */}
        {pdfUrl && !isCompiling && useFallback && (
          <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
            <div className="relative">
              <FileText className="h-20 w-20 text-primary/80" />
              <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-1">
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="font-medium text-lg">PDF Ready</p>
              <p className="text-sm text-muted-foreground mt-1">Your document has been generated</p>
            </div>
            <div className="w-full max-w-xs space-y-3">
              <Button
                className="w-full h-12 text-base"
                onClick={() => {
                  // Open PDF in new tab - user can view and use Safari's share
                  const link = document.createElement('a');
                  link.href = pdfUrl;
                  link.target = '_blank';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
              >
                <FileText className="h-5 w-5 mr-2" />
                Open PDF
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Tap "Open PDF", then use Safari's share button to save
            </p>
          </div>
        )}

        {/* PDF Viewer - Full viewer for other devices */}
        {pdfUrl && !isCompiling && !useFallback && (
          <div className="flex flex-col items-center p-2">
            {pdfLoading && !pdfError && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            )}
            {pdfError ? (
              <div className="flex flex-col items-center justify-center py-8 gap-4">
                <AlertCircle className="h-12 w-12 text-destructive/70" />
                <p className="text-sm text-muted-foreground">{pdfError}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = pdfUrl;
                    link.target = '_blank';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                >
                  Open in Browser Instead
                </Button>
              </div>
            ) : (
              <Document
                file={pdfUrl}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                loading={null}
                className="flex flex-col items-center"
                error={
                  <div className="flex flex-col items-center justify-center py-8 gap-4">
                    <AlertCircle className="h-12 w-12 text-destructive/70" />
                    <p className="text-sm text-muted-foreground">Failed to render PDF</p>
                  </div>
                }
              >
                <Page
                  pageNumber={currentPage}
                  width={Math.min(window.innerWidth - 16, 400)}
                  className="shadow-lg"
                  loading={
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  }
                  error={
                    <div className="flex items-center justify-center py-8">
                      <p className="text-sm text-muted-foreground">Error rendering page</p>
                    </div>
                  }
                />
              </Document>
            )}
          </div>
        )}

        {/* Initial State */}
        {!pdfUrl && !displayError && !isCompiling && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <FileText className="h-16 w-16 text-muted-foreground/30" />
            <div className="text-center">
              <p className="font-medium">No Preview Available</p>
              <p className="text-sm text-muted-foreground mt-1">Edit your document to generate a preview</p>
            </div>
          </div>
        )}
      </div>

      {/* Page Navigation Footer - only for full viewer mode */}
      {pdfUrl && !isCompiling && numPages > 0 && !pdfError && !useFallback && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-card shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
            className="h-9 px-3"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Prev
          </Button>

          <span className="text-sm font-medium">
            Page {currentPage} of {numPages}
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={goToNextPage}
            disabled={currentPage >= numPages}
            className="h-9 px-3"
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
