import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useDeviceInfo } from '@/utils/device';
import { cn } from '@/lib/utils';
// Side effect: sets the single pdf.js workerSrc for the whole app.
import { getDprCap } from './pdfConfig';
import { usePdfDocumentSwap, type DocSlot } from './usePdfDocumentSwap';
import { usePdfZoom } from './usePdfZoom';
import { useFullscreen } from './useFullscreen';
import { PdfPageLayer, type PdfPageLayerHandle } from './PdfPageLayer';
import { PdfViewerToolbar } from './PdfViewerToolbar';

export interface PdfViewerProps {
  pdfUrl: string;
  className?: string;
  /** Hide the fullscreen control (the mobile modal is already fullscreen). */
  showFullscreen?: boolean;
}

/**
 * The unified in-app PDF viewer — one component for the desktop preview panel
 * and the mobile preview modal. Pages render as paper floating on the app's
 * mat with a slim design-language toolbar, and recompiled documents swap in
 * place: the outgoing document stays visible while the incoming one
 * pre-renders in a hidden layer at the same geometry, then the old layer
 * crossfades away on top of the new one. No white flash, no scroll jump.
 *
 * Layer lifecycle on a recompile (URL change):
 *   1. active layer (gen N) keeps rendering; a hidden layer (gen N+1) mounts,
 *      loads the new blob, and paints the pages around the current scrollTop.
 *   2. on ready (or a 1.2s safety timeout) the active scrollTop is copied to
 *      the hidden layer, the swap machine promotes gen N+1, and — because both
 *      layers are keyed by generation — React preserves the freshly painted
 *      instance as the new active layer.
 *   3. the old gen N layer sticks around ~180ms with a fade-out class (skipped
 *      under prefers-reduced-motion), then unmounts.
 */
export default function PdfViewer({ pdfUrl, className, showFullscreen = true }: PdfViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activeLayerRef = useRef<PdfPageLayerHandle>(null);
  const incomingLayerRef = useRef<PdfPageLayerHandle>(null);
  const reducedMotion = useReducedMotion();
  const deviceInfo = useDeviceInfo();
  const dprCap = getDprCap(deviceInfo.isIOS);

  const { state, onIncomingLoaded, onIncomingReady, onIncomingFailed } = usePdfDocumentSwap(pdfUrl);

  const [docMeta, setDocMeta] = useState<{ numPages: number; baseWidth: number } | null>(null);
  const [pageInView, setPageInView] = useState(1);
  const [loadFailed, setLoadFailed] = useState(false);
  // The active layer's scroll position at the moment an incoming document was
  // staged — the hidden layer pre-renders around it. Captured in an effect
  // (refs are off-limits during render).
  const [stagedScrollTop, setStagedScrollTop] = useState(0);
  // The just-replaced layer, kept mounted briefly (same key → same instance)
  // so it can fade out over the promoted one.
  const [fadingSlot, setFadingSlot] = useState<DocSlot | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { mode, pageWidth, effectiveScale, zoomStep, zoomFit } = usePdfZoom(
    rootRef,
    docMeta?.baseWidth ?? null
  );
  const fullscreen = useFullscreen(rootRef);

  // Promotion hand-off: copy the active layer's scroll position onto the
  // incoming layer, start the old layer's fade, THEN promote.
  const handleIncomingReady = useCallback(
    (gen: number) => {
      const scrollTop = activeLayerRef.current?.getScrollTop() ?? 0;
      incomingLayerRef.current?.setScrollTop(scrollTop);
      if (!reducedMotion && state.active) {
        setFadingSlot(state.active);
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = setTimeout(() => setFadingSlot(null), 180);
      }
      onIncomingReady(gen);
    },
    [onIncomingReady, reducedMotion, state.active]
  );

  useEffect(
    () => () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    },
    []
  );

  const incomingGen = state.incoming?.gen ?? null;
  useEffect(() => {
    if (incomingGen !== null) {
      setStagedScrollTop(activeLayerRef.current?.getScrollTop() ?? 0);
    }
  }, [incomingGen]);

  // Meta comes from whichever layer loaded most recently (the incoming layer
  // reports during pre-render, so a page-count change is reflected by the time
  // it's promoted).
  const handleDocMeta = useCallback((_gen: number, meta: { numPages: number; baseWidth: number }) => {
    setDocMeta(meta);
    setLoadFailed(false);
  }, []);

  const handleActiveFailed = useCallback(() => setLoadFailed(true), []);

  const openInTab = useCallback(() => {
    window.open(pdfUrl, '_blank', 'noopener');
  }, [pdfUrl]);

  const goToPage = useCallback(
    (delta: 1 | -1) => {
      activeLayerRef.current?.scrollToPage(pageInView - 1 + delta, !reducedMotion);
    },
    [pageInView, reducedMotion]
  );

  if (loadFailed) {
    return (
      <div className={cn('flex h-full flex-col items-center justify-center gap-3 p-6', className)}>
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <p className="max-w-[22rem] text-center text-sm text-muted-foreground">
          The preview couldn&apos;t be rendered here.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={openInTab}>
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open in browser tab
        </Button>
      </div>
    );
  }

  const showFading = fadingSlot && fadingSlot.gen !== (state.active?.gen ?? -1);

  return (
    <div
      ref={rootRef}
      className={cn(
        'flex h-full flex-col bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))]',
        className
      )}
    >
      <PdfViewerToolbar
        page={pageInView}
        pageCount={docMeta?.numPages ?? 0}
        zoomPercent={Math.round(effectiveScale * 100)}
        isFitWidth={mode.kind === 'fit-width'}
        onPrevPage={() => goToPage(-1)}
        onNextPage={() => goToPage(1)}
        onZoomIn={() => zoomStep(1)}
        onZoomOut={() => zoomStep(-1)}
        onZoomFit={zoomFit}
        onOpenInTab={openInTab}
        fullscreen={showFullscreen && fullscreen.available ? fullscreen : null}
      />
      <div className="relative min-h-0 flex-1">
        {state.active && (
          <PdfPageLayer
            key={state.active.gen}
            ref={activeLayerRef}
            url={state.active.url}
            gen={state.active.gen}
            pageWidth={pageWidth}
            dprCap={dprCap}
            visible
            onDocMeta={handleDocMeta}
            onPageInView={setPageInView}
            onFailed={handleActiveFailed}
          />
        )}
        {state.incoming && (
          <PdfPageLayer
            key={state.incoming.gen}
            ref={incomingLayerRef}
            url={state.incoming.url}
            gen={state.incoming.gen}
            pageWidth={pageWidth}
            dprCap={dprCap}
            visible={false}
            initialScrollTop={stagedScrollTop}
            onDocMeta={handleDocMeta}
            onLoaded={onIncomingLoaded}
            onReady={handleIncomingReady}
            onFailed={onIncomingFailed}
          />
        )}
        {showFading && (
          <PdfPageLayer
            key={fadingSlot.gen}
            url={fadingSlot.url}
            gen={fadingSlot.gen}
            pageWidth={pageWidth}
            dprCap={dprCap}
            visible={false}
            fadingOut
          />
        )}
      </div>
    </div>
  );
}
