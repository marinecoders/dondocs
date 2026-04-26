import { useState, useCallback, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { X, Loader2, AlertCircle, ScrollText, Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { useLogStore } from '@/stores/logStore';
import { downloadPdfBlob, preOpenWindowForIOS } from '@/utils/downloadPdf';
import { useDeviceInfo } from '@/utils/device';
import { debug } from '@/lib/debug';

/**
 * PDF Preview Strategy:
 * 
 * iOS (iPhone AND iPad): Use react-pdf-viewer
 *   - react-pdf crashes on iOS due to canvas memory limits (384MB)
 *   - react-pdf-viewer has better memory management
 *   - Reference: https://github.com/wojtekmaj/react-pdf/issues/1601
 * 
 * Non-iOS (Android, Desktop): Use react-pdf
 *   - Works fine, simpler setup
 * 
 * NOTE: We tried using iframe for iPad but it showed black screen.
 * react-pdf-viewer works reliably on both iPhone and iPad.
 */

// iOS viewer: react-pdf-viewer with full features (zoom, thumbnails, navigation)
import { Worker, Viewer } from '@react-pdf-viewer/core';
import { defaultLayoutPlugin } from '@react-pdf-viewer/default-layout';
import type { ToolbarSlot } from '@react-pdf-viewer/default-layout';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/default-layout/lib/styles/index.css';

// Custom CSS to theme react-pdf-viewer to match app theme
const pdfViewerStyles = `
  /* Theme react-pdf-viewer to match app */
  .rpv-core__viewer {
    --rpv-color-primary: hsl(var(--primary));
    --rpv-color-primary-foreground: hsl(var(--primary-foreground));
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  /* Toolbar styling */
  .rpv-default-layout__toolbar {
    background-color: hsl(var(--card)) !important;
    border-bottom: 1px solid hsl(var(--border)) !important;
  }

  .rpv-core__minimal-button {
    color: hsl(var(--foreground)) !important;
  }

  .rpv-core__minimal-button:hover {
    background-color: hsl(var(--accent)) !important;
  }

  /* Sidebar styling */
  .rpv-default-layout__sidebar {
    background-color: hsl(var(--card)) !important;
    border-right: 1px solid hsl(var(--border)) !important;
  }

  .rpv-default-layout__sidebar-headers {
    background-color: hsl(var(--muted)) !important;
  }

  .rpv-default-layout__sidebar-tab {
    color: hsl(var(--muted-foreground)) !important;
  }

  .rpv-default-layout__sidebar-tab--selected {
    color: hsl(var(--primary)) !important;
    border-color: hsl(var(--primary)) !important;
  }

  /* Thumbnail styling */
  .rpv-thumbnail__container {
    background-color: hsl(var(--card)) !important;
  }

  .rpv-thumbnail__item--selected .rpv-thumbnail__cover::after {
    border-color: hsl(var(--primary)) !important;
  }

  /* Body/main area styling */
  .rpv-default-layout__body {
    background-color: hsl(var(--muted) / 0.3) !important;
  }

  .rpv-core__inner-pages {
    background-color: transparent !important;
  }

  /* Popover/dropdown styling */
  .rpv-core__popover-body {
    background-color: hsl(var(--popover)) !important;
    border: 1px solid hsl(var(--border)) !important;
    color: hsl(var(--popover-foreground)) !important;
  }

  .rpv-core__menu-item:hover {
    background-color: hsl(var(--accent)) !important;
  }

  /* Scrollbar styling */
  .rpv-core__inner-pages::-webkit-scrollbar-thumb {
    background-color: hsl(var(--muted-foreground) / 0.3) !important;
  }

  /* Page number input */
  .rpv-core__textbox {
    background-color: hsl(var(--input)) !important;
    border-color: hsl(var(--border)) !important;
    color: hsl(var(--foreground)) !important;
  }

  /* Zoom dropdown */
  .rpv-zoom__popover-target-scale {
    color: hsl(var(--foreground)) !important;
  }
`;

// Configure pdf.js worker for react-pdf (non-iOS)
// react-pdf v10 uses pdfjs-dist v5 — worker copied to public/lib/
pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}lib/pdf.worker.min.mjs`;

// Worker URL for react-pdf-viewer (iOS)
const PDFJS_WORKER_URL = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

/**
 * Hardened pdf.js options. Both viewers below preview user-supplied PDFs
 * (compiled main + uploaded enclosures), so we force the safer code path.
 *
 * `isEvalSupported: false` mitigates CVE-2024-4367: PDF.js's eval-based
 * font glyph renderer can be coerced into executing arbitrary JavaScript
 * by a maliciously crafted PDF. Disabling it routes glyph rendering
 * through the slower-but-safe non-eval path. The desktop preview uses an
 * `<iframe>` and the browser's native PDF viewer, so it isn't affected;
 * this hardening is specifically for the mobile path which renders
 * pdf.js in our origin.
 *
 * `@react-pdf-viewer/core@3.12.0` pulls in the vulnerable
 * `pdfjs-dist@3.11.174` transitively (`react-pdf@10` is fine on 5.x);
 * upstream is dormant so a version bump isn't currently available. Until
 * we migrate `MobilePreviewModal` off `@react-pdf-viewer`, this option
 * closes the active exploit path.
 *
 * Note: defined at module scope so that `<Document options={...}>` gets
 * a referentially stable object — react-pdf reprocesses the document
 * when `options` changes by identity.
 */
const HARDENED_PDF_OPTIONS = { isEvalSupported: false } as const;
const transformPdfParamsHardened = (
  options: Record<string, unknown>,
): Record<string, unknown> => ({
  ...options,
  isEvalSupported: false,
});

interface MobilePreviewModalProps {
  pdfUrl: string | null;
  isCompiling: boolean;
  error: string | null;
  onDownloadPdf?: () => void;
}

/**
 * iOS PDF Viewer Component using react-pdf-viewer
 * 
 * Used for BOTH iPhone and iPad because:
 * - react-pdf crashes on iOS due to canvas memory limits
 * - iframe shows black screen on iPad (tested and failed)
 * - react-pdf-viewer works reliably on all iOS devices
 * 
 * Features: zoom controls, page thumbnails sidebar, page navigation, search
 */
function IOSPdfViewer({ pdfUrl, onClose, onDownload, isPhone }: {
  pdfUrl: string;
  onClose: () => void;
  onDownload: () => void;
  isPhone: boolean;
}) {
  // Inject custom styles on mount
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.textContent = pdfViewerStyles;
    document.head.appendChild(styleEl);
    return () => {
      document.head.removeChild(styleEl);
    };
  }, []);

  // Create the default layout plugin with all features
  const defaultLayoutPluginInstance = defaultLayoutPlugin({
    sidebarTabs: (defaultTabs) => [
      // Only show thumbnails tab for cleaner mobile UI
      defaultTabs[0], // Thumbnails
    ],
    renderToolbar: (Toolbar) => (
      <Toolbar>
        {(slots: ToolbarSlot) => {
          const {
            CurrentPageInput,
            GoToNextPage,
            GoToPreviousPage,
            NumberOfPages,
            ShowSearchPopover,
            Zoom,
            ZoomIn,
            ZoomOut,
            EnterFullScreen,
          } = slots;
          return (
            <div className="rpv-toolbar" style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              padding: '4px 8px',
              gap: '4px'
            }}>
              {/* Left: Navigation */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <GoToPreviousPage />
                <CurrentPageInput /> / <NumberOfPages />
                <GoToNextPage />
              </div>

              {/* Center: Zoom */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' }}>
                <ZoomOut />
                <Zoom />
                <ZoomIn />
              </div>

              {/* Right: Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' }}>
                <ShowSearchPopover />
                <EnterFullScreen />
              </div>
            </div>
          );
        }}
      </Toolbar>
    ),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Modal Header with Download and Close */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0">
        <span className="font-semibold text-sm">PDF Preview</span>
        <div className="flex items-center gap-1">
          <Button
            variant="default"
            size="sm"
            onClick={onDownload}
            className="h-8 px-3"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Download
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* PDF Viewer */}
      <div className="flex-1 overflow-hidden">
        <Worker workerUrl={PDFJS_WORKER_URL}>
          <div style={{ height: 'calc(100vh - 52px)' }}>
            <Viewer
              fileUrl={pdfUrl}
              plugins={[defaultLayoutPluginInstance]}
              defaultScale={isPhone ? 0.5 : 1}
              transformGetDocumentParams={transformPdfParamsHardened}
            />
          </div>
        </Worker>
      </div>
    </div>
  );
}

export function MobilePreviewModal({ pdfUrl, isCompiling, error }: MobilePreviewModalProps) {
  // Individual selectors — modal only re-renders on its own flag changing.
  const mobilePreviewOpen = useUIStore((s) => s.mobilePreviewOpen);
  const setMobilePreviewOpen = useUIStore((s) => s.setMobilePreviewOpen);
  const { setOpen: setLogViewerOpen, setEnabled: setLogEnabled } = useLogStore();
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [viewportWidth, setViewportWidth] = useState<number>(window.innerWidth);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Track viewport width reactively for device rotation
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Use centralized device detection
  const deviceInfo = useDeviceInfo();

  useEffect(() => {
    if (deviceInfo.isIOS) {
      debug.log('MobilePreview', 'iOS detected - using react-pdf-viewer');
      debug.log('MobilePreview', 'Device:', { isIOS: deviceInfo.isIOS, isIPad: deviceInfo.isIPad, isIPhone: deviceInfo.isIPhone });
    }
  }, [deviceInfo]);

  // Reset state when modal opens or pdfUrl changes
  useEffect(() => {
    if (mobilePreviewOpen && pdfUrl) {
      setCurrentPage(1);
    }
  }, [mobilePreviewOpen, pdfUrl]);

  // Filter out engine reset message
  const displayError = error === 'ENGINE_RESET_NEEDED' ? null : error;

  const handleOpenLogs = () => {
    setLogEnabled(true);
    setLogViewerOpen(true);
  };

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setCurrentPage(1);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    debug.error('MobilePreview', 'PDF load error:', err?.message || err);
  }, []);

  // Track visible page via IntersectionObserver
  useEffect(() => {
    if (!mobilePreviewOpen || numPages === 0) return;

    // Defer observer setup to ensure page refs are populated after async render
    const rafId = requestAnimationFrame(() => {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const pageNum = Number(entry.target.getAttribute('data-page'));
              if (pageNum) setCurrentPage(pageNum);
            }
          }
        },
        { root: scrollContainerRef.current, threshold: 0.5 }
      );

      pageRefs.current.forEach((el) => observer.observe(el));
      observerRef.current = observer;
    });

    const observerRef = { current: null as IntersectionObserver | null };
    return () => {
      cancelAnimationFrame(rafId);
      observerRef.current?.disconnect();
    };
  }, [mobilePreviewOpen, numPages]);

  // Download handler using centralized download utility
  const handleDownload = async () => {
    if (!pdfUrl) return;

    const preOpenedWindow = preOpenWindowForIOS();

    try {
      const response = await fetch(pdfUrl);
      const blob = await response.blob();
      await downloadPdfBlob(blob, 'correspondence.pdf', preOpenedWindow);
    } catch (err) {
      debug.error('MobilePreview', 'Download failed:', err);
      if (preOpenedWindow) {
        preOpenedWindow.location.href = pdfUrl;
      } else {
        window.open(pdfUrl, '_blank');
      }
    }
  };

  if (!mobilePreviewOpen) return null;

  // iOS (iPhone AND iPad): Use react-pdf-viewer
  // This is the ONLY viewer that works reliably on iOS
  // - react-pdf crashes due to canvas memory limits
  // - iframe shows black screen on iPad
  if (deviceInfo.isIOS && pdfUrl && !isCompiling && !displayError) {
    const isPhone = !deviceInfo.isIPad; // iPhone/iPod = phone, iPad = tablet
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <IOSPdfViewer
          pdfUrl={pdfUrl}
          onClose={() => setMobilePreviewOpen(false)}
          onDownload={handleDownload}
          isPhone={isPhone}
        />
      </div>
    );
  }

  // Non-iOS fallback: Standard modal with react-pdf
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0">
        <span className="font-semibold text-sm">PDF Preview</span>
        <div className="flex items-center gap-1">
          {pdfUrl && !isCompiling && (
            <Button
              variant="default"
              size="sm"
              onClick={handleDownload}
              className="h-8 px-3"
            >
              <Download className="h-4 w-4 mr-1.5" />
              Download
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

        {/* Compilation Error State */}
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

        {/* PDF Viewer - non-iOS: react-pdf scrollable all-pages view */}
        {/* Note: iframe doesn't work on mobile — browsers can't render blob URLs inline */}
        {pdfUrl && !isCompiling && (
          <div
            ref={scrollContainerRef}
            className="flex flex-col items-center p-2 gap-4 min-h-full overflow-auto"
            style={{ touchAction: 'pan-y pinch-zoom' }}
          >
            <Document
              file={pdfUrl}
              options={HARDENED_PDF_OPTIONS}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              }
              className="flex flex-col items-center gap-4"
              error={
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <AlertCircle className="h-12 w-12 text-destructive/70" />
                  <p className="text-sm text-muted-foreground">Failed to render PDF</p>
                  <Button variant="outline" onClick={handleDownload}>
                    <Download className="h-4 w-4 mr-2" />
                    Download Instead
                  </Button>
                </div>
              }
            >
              {Array.from(new Array(numPages), (_, index) => (
                <div
                  key={index}
                  ref={(el) => { if (el) pageRefs.current.set(index + 1, el); }}
                  data-page={index + 1}
                >
                  <Page
                    pageNumber={index + 1}
                    width={Math.min(viewportWidth - 16, 960)}
                    className="shadow-lg"
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    loading={
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    }
                    error={
                      <div className="flex items-center justify-center py-12">
                        <p className="text-sm text-muted-foreground">Error rendering page {index + 1}</p>
                      </div>
                    }
                  />
                </div>
              ))}
            </Document>

            {/* Floating page indicator */}
            {numPages > 1 && (
              <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur-sm border border-border rounded-full px-3 py-1 text-xs font-medium shadow-lg">
                Page {currentPage} of {numPages}
              </div>
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

    </div>
  );
}
