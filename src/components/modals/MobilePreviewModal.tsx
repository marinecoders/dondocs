import { X, Loader2, AlertCircle, ScrollText, Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { useLogStore } from '@/stores/logStore';
import { downloadPdfBlob, preOpenWindowForIOS } from '@/utils/downloadPdf';
import { debug } from '@/lib/debug';
// Static import on purpose: this modal is itself lazy-loaded from App, and the
// desktop panel dynamically imports the same viewer — Rollup therefore emits
// PdfViewer (react-pdf + pdf.js) as one shared chunk used by both surfaces.
// The viewer replaced the previous per-platform split (react-pdf-viewer on
// iOS, a bare react-pdf scroll on Android): its page virtualization and DPR
// cap keep canvas memory inside iOS budgets, so one implementation serves all.
import PdfViewer from '@/components/pdf/PdfViewer';

interface MobilePreviewModalProps {
  pdfUrl: string | null;
  isCompiling: boolean;
  error: string | null;
  onDownloadPdf?: () => void;
}

/**
 * Full-screen mobile preview. The header keeps the download / logs / close
 * actions; the body is the shared in-app viewer (same one the desktop panel
 * renders), which brings zoom, page navigation, and the flicker-free
 * recompile swap to mobile.
 */
export function MobilePreviewModal({ pdfUrl, isCompiling, error }: MobilePreviewModalProps) {
  // Individual selectors — modal only re-renders on its own flag changing.
  const mobilePreviewOpen = useUIStore((s) => s.mobilePreviewOpen);
  const setMobilePreviewOpen = useUIStore((s) => s.setMobilePreviewOpen);
  const { setOpen: setLogViewerOpen, setEnabled: setLogEnabled } = useLogStore();

  // Filter out engine reset message — it's not a user-facing error.
  const displayError = error === 'ENGINE_RESET_NEEDED' ? null : error;

  const handleOpenLogs = () => {
    setLogEnabled(true);
    setLogViewerOpen(true);
  };

  // Download via the centralized platform-aware utility (iOS needs a window
  // pre-opened inside the user gesture).
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

  return (
    // `fixed inset-0` extends under a notched phone's status bar and home
    // indicator (index.html sets viewport-fit=cover), so the header and content
    // pad by the safe-area insets — without this the title and Download/Logs/
    // Close controls render behind the clock/dynamic island in a standalone
    // install, and the viewer's bottom edge sits under the home indicator.
    <div
      className="fixed inset-0 z-50 bg-background flex flex-col"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
      >
        <span className="font-semibold text-sm">PDF Preview</span>
        <div className="flex items-center gap-1">
          {pdfUrl && !isCompiling && (
            <Button variant="default" size="sm" onClick={handleDownload} className="h-8 px-3">
              <Download className="h-4 w-4 mr-1.5" />
              Download
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleOpenLogs}>
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

      {/* Content */}
      <div className="flex-1 min-h-0">
        {isCompiling && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="relative">
              <FileText className="h-16 w-16 text-muted-foreground/30" />
              <Loader2 className="h-8 w-8 animate-spin text-primary absolute -bottom-1 -right-1 bg-background rounded-full p-1" />
            </div>
            <div className="text-center">
              <p className="font-medium">Generating PDF…</p>
              <p className="text-sm text-muted-foreground mt-1">This should only take a moment.</p>
            </div>
          </div>
        )}

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

        {/* The modal is already full-screen — hide the redundant fullscreen control. */}
        {pdfUrl && !isCompiling && <PdfViewer pdfUrl={pdfUrl} showFullscreen={false} />}

        {!pdfUrl && !displayError && !isCompiling && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <FileText className="h-16 w-16 text-muted-foreground/30" />
            <div className="text-center">
              <p className="font-medium">No Preview Available</p>
              <p className="text-sm text-muted-foreground mt-1">
                Edit your document to generate a preview
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
