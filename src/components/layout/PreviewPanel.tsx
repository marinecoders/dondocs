import { useEffect, useRef, useCallback } from 'react';
import { Loader2, AlertCircle, Eye, Paperclip } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { ReadinessMeter } from './ReadinessMeter';

interface PreviewPanelProps {
  pdfUrl: string | null;
  isCompiling: boolean;
  /** The one-time in-browser LaTeX engine boot (distinct from a routine
   *  recompile) — the slowest, most anxious wait, so it gets its own copy. */
  isWarmingUp?: boolean;
  /** True once the resting preview has been upgraded to include enclosures +
   *  signature (full quality), so the "encl. in download" note can stand down. */
  previewEnhanced?: boolean;
  error: string | null;
}

export function PreviewPanel({ pdfUrl, isCompiling, isWarmingUp = false, previewEnhanced = false, error }: PreviewPanelProps) {
  // Individual selectors so this panel only re-renders when one of these
  // four fields actually changes (not on any other UI-store update).
  const previewVisible = useUIStore((s) => s.previewVisible);
  const isMobile = useUIStore((s) => s.isMobile);
  const setMobilePreviewOpen = useUIStore((s) => s.setMobilePreviewOpen);
  const fullQualityPreview = useUIStore((s) => s.fullQualityPreview);
  const enclosureCount = useDocumentStore((s) => s.enclosures.length);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const savedScrollRef = useRef<{ scrollTop: number; scrollLeft: number } | null>(null);
  const previousUrlRef = useRef<string | null>(null);

  // Save scroll position before PDF URL changes
  const saveScrollPosition = useCallback(() => {
    try {
      const iframe = iframeRef.current;
      if (iframe?.contentWindow?.document?.scrollingElement) {
        const scrollEl = iframe.contentWindow.document.scrollingElement;
        savedScrollRef.current = {
          scrollTop: scrollEl.scrollTop,
          scrollLeft: scrollEl.scrollLeft,
        };
      }
    } catch {
      // Cross-origin restrictions may prevent access - silently ignore
    }
  }, []);

  // Restore scroll position after PDF loads
  const restoreScrollPosition = useCallback(() => {
    const saved = savedScrollRef.current;
    if (!saved) return;

    // Try multiple times as PDF viewer may take time to initialize
    const attempts = [100, 300, 600, 1000];
    attempts.forEach((delay) => {
      setTimeout(() => {
        try {
          const iframe = iframeRef.current;
          if (iframe?.contentWindow?.document?.scrollingElement) {
            const scrollEl = iframe.contentWindow.document.scrollingElement;
            scrollEl.scrollTop = saved.scrollTop;
            scrollEl.scrollLeft = saved.scrollLeft;
          }
        } catch {
          // Cross-origin restrictions may prevent access - silently ignore
        }
      }, delay);
    });
  }, []);

  // Handle PDF URL changes - save position before, restore after
  useEffect(() => {
    if (pdfUrl && previousUrlRef.current && pdfUrl !== previousUrlRef.current) {
      // URL is changing, save current scroll position
      saveScrollPosition();
    }
    previousUrlRef.current = pdfUrl;
  }, [pdfUrl, saveScrollPosition]);

  // Handle iframe load event to restore scroll position
  const handleIframeLoad = useCallback(() => {
    if (savedScrollRef.current) {
      restoreScrollPosition();
    }
  }, [restoreScrollPosition]);

  // Filter out engine reset message - it's not a user-facing error
  const displayError = error === 'ENGINE_RESET_NEEDED' ? null : error;

  // Mobile: show floating button
  if (isMobile) {
    return (
      <button
        className="fixed bottom-6 right-4 z-50 shadow-xl bg-primary text-primary-foreground px-5 py-3 rounded-full flex items-center gap-2 hover:bg-primary/90 transition-colors text-sm font-medium"
        style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onClick={() => setMobilePreviewOpen(true)}
        aria-label="Preview PDF"
      >
        <Eye className="h-5 w-5" aria-hidden="true" />
        Preview PDF
      </button>
    );
  }

  // Desktop: if preview is hidden, render nothing (toggle is in Header now)
  if (!previewVisible) {
    return null;
  }

  return (
    <div className="flex flex-col bg-background h-full">
      {/* Header */}
      <div className="relative flex items-center justify-between px-4 py-2 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Preview</span>
          {/* Aria-live region for compilation status - WCAG 4.1.3 */}
          <div aria-live="polite" aria-atomic="true" className="sr-only">
            {isWarmingUp
              ? 'Warming up the typesetter, one-time setup...'
              : isCompiling
                ? 'Compiling document...'
                : 'Compilation complete'}
          </div>
          {/* Compile state reads as a quiet label plus the slim sweep below —
              motion communicates the state, not a spinner badge. */}
          {isCompiling && (
            <span className="text-xs text-muted-foreground whitespace-nowrap" aria-hidden="true">
              {isWarmingUp ? 'Warming up…' : 'Compiling…'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Readiness ring — driven by the single documentCompleteness rule, so
              it can't contradict the rail's section dots. */}
          <ReadinessMeter />
          {enclosureCount > 0 && !fullQualityPreview && !previewEnhanced && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground" title="Enclosures are included in the downloaded PDF. The preview upgrades to show them once you pause.">
              <Paperclip className="h-3 w-3" />
              <span className="tnum">{enclosureCount} encl. in download</span>
            </div>
          )}
        </div>
        {/* Indeterminate compile sweep — slim, scarlet, riding the header's
            bottom edge. Transform-only (dd-progress) so a throttled animation
            clock can't strand it mid-frame; dd-anim disables it under
            prefers-reduced-motion (the "Compiling…" label still conveys state). */}
        {isCompiling && (
          <div className="absolute left-0 right-0 -bottom-px h-0.5 overflow-hidden" aria-hidden="true">
            <div
              className="dd-anim h-full w-1/4 bg-primary"
              style={{ animation: 'dd-progress 1.1s cubic-bezier(0.4,0,0.2,1) infinite' }}
            />
          </div>
        )}
      </div>

      {/* Content — a deeper mat so the document reads as paper resting on a
          surface (visible in the empty / loading / error states; the embedded
          PDF viewer supplies its own mat once a page is shown). */}
      <div className="flex-1 relative bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))]">
        {/* Show PDF if available, with optional loading overlay */}
        {pdfUrl && (
          <>
            <iframe
              ref={iframeRef}
              src={pdfUrl}
              className="absolute inset-0 w-full h-full border-0"
              title="Document preview"
              onLoad={handleIframeLoad}
            />
            {/* While recompiling, the stale PDF stays visible and unobscured —
                the header's compile sweep conveys the in-flight state instead of
                a blocking overlay wash. */}
            {/* Persistent error banner shown OVER the (now stale) PDF so the
                user knows their latest edits failed to compile. Previously
                this branch was gated on `!pdfUrl`, which meant once any
                compile had ever succeeded, subsequent failures left no
                visible indicator — see the auto-popup modal in App.tsx for
                the one-shot attention-grabber that complements this banner. */}
            {displayError && !isCompiling && (
              <div
                className="absolute top-0 inset-x-0 flex items-start gap-2 bg-destructive/10 border-b border-destructive/30 text-destructive px-3 py-2 text-xs"
                role="alert"
              >
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">Compile failed — preview is out of date</div>
                  <div className="break-words opacity-90">{displayError}</div>
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
                isWarmingUp ? (
                  <>
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm font-medium">Warming up the typesetter…</p>
                    <p className="max-w-[19rem] text-center text-xs text-muted-foreground">
                      One-time setup — the LaTeX engine loads into your browser. Everything runs locally, and this won&apos;t happen again.
                    </p>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm font-medium">Generating PDF…</p>
                    <p className="text-xs text-muted-foreground">This should only take a moment.</p>
                  </>
                )
              ) : (
                <>
                  <Eye className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Your document preview will appear here</p>
                  <p className="max-w-[16rem] text-center text-xs text-muted-foreground">
                    Fill in the Subject and body on the left — the formatted letter renders here as you type.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
