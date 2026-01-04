import { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';

interface PreviewPanelProps {
  pdfUrl: string | null;
  isCompiling: boolean;
  error: string | null;
}

export function PreviewPanel({ pdfUrl, isCompiling, error }: PreviewPanelProps) {
  const { previewVisible, togglePreview, isMobile, setMobilePreviewOpen } = useUIStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeKey, setIframeKey] = useState(0);

  // Force iframe refresh when PDF URL changes
  useEffect(() => {
    if (pdfUrl) {
      setIframeKey((k) => k + 1);
    }
  }, [pdfUrl]);

  // Filter out engine reset message - it's not a user-facing error
  const displayError = error === 'ENGINE_RESET_NEEDED' ? null : error;

  if (isMobile) {
    return (
      <Button
        className="fixed bottom-4 right-4 z-50 shadow-lg"
        onClick={() => setMobilePreviewOpen(true)}
      >
        <Eye className="h-4 w-4 mr-2" />
        Preview PDF
      </Button>
    );
  }

  if (!previewVisible) {
    return (
      <div className="w-12 bg-card border-l border-border flex flex-col items-center py-4">
        <Button variant="ghost" size="icon" onClick={togglePreview} title="Show Preview">
          <Eye className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">PDF Preview</span>
          {isCompiling && (
            <div className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Compiling...</span>
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={togglePreview} title="Hide Preview">
          <EyeOff className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 relative bg-muted/30">
        {/* Show PDF if available, with optional loading overlay */}
        {pdfUrl && (
          <>
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={pdfUrl}
              className="absolute inset-0 w-full h-full border-0"
              title="PDF Preview"
            />
            {/* Loading overlay on top of existing PDF */}
            {isCompiling && (
              <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 bg-card px-6 py-4 rounded-lg shadow-lg border border-border">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm font-medium">Compiling document...</p>
                </div>
              </div>
            )}
          </>
        )}

        {/* Error state - only show if no PDF */}
        {displayError && !pdfUrl && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive">{displayError}</p>
            </div>
          </div>
        )}

        {/* Initial loading state - no PDF yet */}
        {!pdfUrl && !displayError && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              {isCompiling ? (
                <>
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="text-sm font-medium">Generating PDF...</p>
                  <p className="text-xs text-muted-foreground">This may take a moment on first load</p>
                </>
              ) : (
                <>
                  <Eye className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">PDF preview will appear here</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
