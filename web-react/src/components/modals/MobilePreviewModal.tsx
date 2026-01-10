import { useState } from 'react';
import { X, Loader2, AlertCircle, ScrollText, Share, ExternalLink, FileText, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { useLogStore } from '@/stores/logStore';

interface MobilePreviewModalProps {
  pdfUrl: string | null;
  isCompiling: boolean;
  error: string | null;
  onDownloadPdf?: () => void;
}

export function MobilePreviewModal({ pdfUrl, isCompiling, error }: MobilePreviewModalProps) {
  const { mobilePreviewOpen, setMobilePreviewOpen } = useUIStore();
  const { setOpen: setLogViewerOpen, setEnabled: setLogEnabled } = useLogStore();
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  // Filter out engine reset message - it's not a user-facing error
  const displayError = error === 'ENGINE_RESET_NEEDED' ? null : error;

  const handleOpenLogs = () => {
    setLogEnabled(true);
    setLogViewerOpen(true);
  };

  const handleOpenInBrowser = () => {
    if (!pdfUrl) return;

    // Use link click instead of window.open for better iOS compatibility
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Save PDF - on iOS we need to open it and let user use native share
  const handleSavePdf = async () => {
    if (!pdfUrl) return;

    try {
      // Fetch the blob and create a fresh blob URL
      const response = await fetch(pdfUrl);
      const blob = await response.blob();

      // Try Web Share API first (iOS 15+)
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

      // Fallback: Create a link and simulate click
      // This works better than window.open on some browsers
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Don't revoke immediately - give browser time to open
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      setShareStatus('Opened - tap share icon to save');
      setTimeout(() => setShareStatus(null), 4000);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Save failed:', err);
        setShareStatus('Error - try "Open in Browser"');
        setTimeout(() => setShareStatus(null), 3000);
      }
    }
  };

  if (!mobilePreviewOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-semibold">Document Preview</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMobilePreviewOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Loading State */}
          {isCompiling && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="relative">
                <FileText className="h-16 w-16 text-muted-foreground/30" />
                <Loader2 className="h-8 w-8 animate-spin text-primary absolute -bottom-1 -right-1 bg-card rounded-full p-1" />
              </div>
              <div className="text-center">
                <p className="font-medium">Generating PDF...</p>
                <p className="text-sm text-muted-foreground mt-1">This may take a moment</p>
              </div>
            </div>
          )}

          {/* Error State */}
          {displayError && !pdfUrl && !isCompiling && (
            <div className="flex flex-col items-center gap-4 py-8">
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

          {/* Ready State - PDF Available */}
          {pdfUrl && !isCompiling && (
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="relative">
                <FileText className="h-20 w-20 text-primary/80" />
                <CheckCircle2 className="h-8 w-8 text-green-500 absolute -bottom-1 -right-1 bg-card rounded-full" />
              </div>
              <div className="text-center">
                <p className="font-medium text-lg">PDF Ready</p>
                <p className="text-sm text-muted-foreground mt-1">Your document has been generated</p>
                {shareStatus && (
                  <p className="text-xs text-primary mt-2">{shareStatus}</p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="w-full space-y-3">
                <Button
                  className="w-full h-12 text-base"
                  onClick={handleSavePdf}
                >
                  <Share className="h-5 w-5 mr-2" />
                  Save PDF
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-12 text-base"
                  onClick={handleOpenInBrowser}
                >
                  <ExternalLink className="h-5 w-5 mr-2" />
                  Open in Browser
                </Button>
              </div>
            </div>
          )}

          {/* Initial State - No PDF yet, not compiling */}
          {!pdfUrl && !displayError && !isCompiling && (
            <div className="flex flex-col items-center gap-4 py-8">
              <FileText className="h-16 w-16 text-muted-foreground/30" />
              <div className="text-center">
                <p className="font-medium">No Preview Available</p>
                <p className="text-sm text-muted-foreground mt-1">Edit your document to generate a preview</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border bg-muted/30 flex justify-center">
          <Button variant="ghost" size="sm" onClick={handleOpenLogs} className="text-muted-foreground">
            <ScrollText className="h-4 w-4 mr-2" />
            View Compilation Logs
          </Button>
        </div>
      </div>
    </div>
  );
}
