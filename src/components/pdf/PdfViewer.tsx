import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useDeviceInfo } from '@/utils/device';
import { useUIStore } from '@/stores/uiStore';
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
  // The column the pages actually live in — this is what fit modes must track
  // (it shrinks when the thumbnail rail opens; the root does not).
  const contentRef = useRef<HTMLDivElement>(null);
  const activeLayerRef = useRef<PdfPageLayerHandle>(null);
  const incomingLayerRef = useRef<PdfPageLayerHandle>(null);
  const reducedMotion = useReducedMotion();
  const deviceInfo = useDeviceInfo();
  const dprCap = getDprCap(deviceInfo.isIOS);

  const { state, onIncomingLoaded, onIncomingReady, onIncomingFailed } = usePdfDocumentSwap(pdfUrl);

  const [docMeta, setDocMeta] = useState<{ numPages: number; baseWidth: number; baseAspect: number } | null>(null);
  const [pageInView, setPageInView] = useState(1);
  const [loadFailed, setLoadFailed] = useState(false);
  // The active layer's scroll position at the moment an incoming document was
  // staged — the hidden layer pre-renders around it. Captured in an effect
  // (refs are off-limits during render).
  const [stagedScrollTop, setStagedScrollTop] = useState(0);
  // Thumbnail rail: preference persists; the toggle only exists on 2+ page
  // documents, so a single-page letter never shows (or pays for) the rail.
  const thumbsOpen = useUIStore((s) => s.pdfThumbnailsOpen);
  const setThumbsOpen = useUIStore((s) => s.setPdfThumbnailsOpen);
  // Callback-ref state so the portal target re-renders the layer when it mounts.
  const [thumbTarget, setThumbTarget] = useState<HTMLDivElement | null>(null);
  // The just-replaced layer, kept mounted briefly (same key → same instance)
  // so it can fade out over the promoted one.
  const [fadingSlot, setFadingSlot] = useState<DocSlot | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { mode, pageWidth, effectiveScale, zoomStep, zoomFitWidth, zoomFitPage } = usePdfZoom(
    contentRef,
    docMeta?.baseWidth ?? null,
    docMeta?.baseAspect ?? null
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
  const handleDocMeta = useCallback(
    (_gen: number, meta: { numPages: number; baseWidth: number; baseAspect: number }) => {
      setDocMeta(meta);
      setLoadFailed(false);
    },
    []
  );

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

  // Direct entry from the toolbar's page input (1-based, pre-clamped there).
  const goToPageNumber = useCallback(
    (n: number) => {
      activeLayerRef.current?.scrollToPage(n - 1, !reducedMotion);
    },
    [reducedMotion]
  );

  // ── Keyboard access ───────────────────────────────────────────────────────
  // The scrollable element lives inside a per-generation layer that is
  // REPLACED on every recompile, so focus can't live there — the stable
  // content wrapper is the keyboard surface instead, routing keys to the
  // active layer. Without this a keyboard-only user could reach the toolbar
  // but never scroll or navigate the document at all.
  const handleContentKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts pass through
      const layer = activeLayerRef.current;
      const pageCount = docMeta?.numPages ?? 0;
      const scrollBy = (delta: number) => {
        if (layer) layer.setScrollTop(layer.getScrollTop() + delta);
      };
      switch (e.key) {
        case 'ArrowDown':
          scrollBy(80);
          break;
        case 'ArrowUp':
          scrollBy(-80);
          break;
        case ' ': {
          // Space / Shift+Space: near-viewport scroll, the universal PDF-reader
          // binding. The wrapper's height ≈ the layer's (layers are inset-0).
          const viewport = contentRef.current?.clientHeight ?? 400;
          scrollBy(e.shiftKey ? -viewport * 0.9 : viewport * 0.9);
          break;
        }
        case 'PageDown':
          goToPage(1);
          break;
        case 'PageUp':
          goToPage(-1);
          break;
        case 'Home':
          layer?.scrollToPage(0, !reducedMotion);
          break;
        case 'End':
          if (pageCount > 0) layer?.scrollToPage(pageCount - 1, !reducedMotion);
          break;
        case '+':
        case '=':
          zoomStep(1);
          break;
        case '-':
          zoomStep(-1);
          break;
        case '0':
          zoomFitWidth();
          break;
        default:
          return; // unhandled: let it propagate (Tab, Escape, …)
      }
      e.preventDefault();
      e.stopPropagation();
    },
    [docMeta?.numPages, goToPage, reducedMotion, zoomStep, zoomFitWidth]
  );

  // Ctrl/⌘ + wheel (and trackpad pinch, which browsers report as ctrl+wheel)
  // zooms the document instead of the page. Must be a native non-passive
  // listener — React's synthetic wheel handlers are passive, so preventDefault
  // there can't stop the browser's own page zoom.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomStep(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // loadFailed in the deps: the error branch renders WITHOUT the content
    // wrapper, so if the viewer ever recovers, the effect must re-run to
    // attach onto the freshly-mounted element.
  }, [zoomStep, loadFailed]);

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
        fitMode={mode.kind === 'fit-width' ? 'width' : mode.kind === 'fit-page' ? 'page' : null}
        thumbnails={
          (docMeta?.numPages ?? 0) >= 2
            ? { open: thumbsOpen, toggle: () => setThumbsOpen(!thumbsOpen) }
            : null
        }
        onGoToPage={goToPageNumber}
        onPrevPage={() => goToPage(-1)}
        onNextPage={() => goToPage(1)}
        onZoomIn={() => zoomStep(1)}
        onZoomOut={() => zoomStep(-1)}
        onZoomFitWidth={zoomFitWidth}
        onZoomFitPage={zoomFitPage}
        onOpenInTab={openInTab}
        fullscreen={showFullscreen && fullscreen.available ? fullscreen : null}
      />
      <div className="flex min-h-0 flex-1">
        {thumbsOpen && (docMeta?.numPages ?? 0) >= 2 && (
          <div
            ref={setThumbTarget}
            className="w-[104px] shrink-0 overflow-y-auto border-r border-border bg-card/50"
            aria-label="Page thumbnails"
          />
        )}
        <div
          ref={contentRef}
          tabIndex={0}
          role="region"
          aria-label="PDF document. Arrow keys and Space scroll, Page Up and Page Down change pages, Home and End jump to the first and last page, plus and minus zoom, 0 fits the width."
          onKeyDown={handleContentKeyDown}
          // ring-inset: the ring must draw inside the scroll area's edges — an
          // outset ring would be clipped by the flex parent and invisible.
          className="relative min-h-0 flex-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
        {/* ONE keyed array on purpose: React only reconciles keys across a
            single children array, not across separate JSX expression slots.
            On promotion the incoming element becomes the active one and the
            old active becomes the fading one — as array siblings their
            instances (and painted canvases) are preserved; as positional
            slots they would remount, refetching a revoked blob URL. The
            fading layer is last so it paints on top while it dissolves. */}
        {[
          state.active && (
            <PdfPageLayer
              key={state.active.gen}
              ref={activeLayerRef}
              url={state.active.url}
              gen={state.active.gen}
              pageWidth={pageWidth}
              dprCap={dprCap}
              visible
              thumbPortalTarget={thumbTarget}
              currentPage={pageInView}
              onDocMeta={handleDocMeta}
              onPageInView={setPageInView}
              onFailed={handleActiveFailed}
            />
          ),
          state.incoming && (
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
          ),
          showFading && (
            <PdfPageLayer
              key={fadingSlot.gen}
              url={fadingSlot.url}
              gen={fadingSlot.gen}
              pageWidth={pageWidth}
              dprCap={dprCap}
              visible={false}
              fadingOut
            />
          ),
        ].filter(Boolean)}
        </div>
      </div>
    </div>
  );
}
