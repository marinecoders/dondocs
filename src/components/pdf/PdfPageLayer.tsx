import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Document, Page } from 'react-pdf';
import { cn } from '@/lib/utils';
import { HARDENED_PDF_OPTIONS } from './pdfConfig';
import {
  computePageLayout,
  contentHeight,
  visibleRange,
  currentPage as currentPageAt,
  clampScrollTop,
  DEFAULT_PAGE_ASPECT,
  type PageLayout,
} from './pdfMath';

/** Vertical gap between pages and mat padding, in CSS px. */
export const PAGE_GAP = 16;
export const LAYER_PAD = 24;

export interface PdfPageLayerHandle {
  getScrollTop: () => number;
  setScrollTop: (v: number) => void;
  scrollToPage: (index: number, smooth: boolean) => void;
}

interface PdfPageLayerProps {
  url: string;
  gen: number;
  pageWidth: number;
  dprCap: number;
  /** Visible (active) layer: owns scrolling and reports page metadata.
   *  Hidden (incoming) layer: pre-renders the restore window only. */
  visible: boolean;
  /** For the hidden layer: the active layer's scrollTop, so the pages the user
   *  is looking at are the ones pre-rendered before promotion. */
  initialScrollTop?: number;
  /** Fade the layer out (promotion crossfade). */
  fadingOut?: boolean;
  onDocMeta?: (gen: number, meta: { numPages: number; baseWidth: number }) => void;
  onPageInView?: (page: number) => void;
  /** Hidden layer only: document parsed (numPages known). */
  onLoaded?: (gen: number) => void;
  /** Hidden layer only: restore-window pages painted. */
  onReady?: (gen: number) => void;
  onFailed?: (gen: number) => void;
}

/**
 * One pdf.js document with a virtualized page stack in its own scroll
 * container. Pages outside the render window are fixed-size placeholders —
 * their canvases unmount and free their backing stores, which is what keeps
 * the viewer inside iOS's canvas memory budget.
 */
export const PdfPageLayer = forwardRef<PdfPageLayerHandle, PdfPageLayerProps>(function PdfPageLayer(
  { url, gen, pageWidth, dprCap, visible, initialScrollTop = 0, fadingOut = false, onDocMeta, onPageInView, onLoaded, onReady, onFailed },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [aspects, setAspects] = useState<number[]>([]);
  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const rafRef = useRef<number | null>(null);
  // Restore-window pages that still need to paint before this (hidden) layer
  // reports ready. Mutated as onRenderSuccess fires; null = not tracking.
  const pendingRenderRef = useRef<Set<number> | null>(null);

  const layout: PageLayout[] = useMemo(() => {
    if (numPages === 0) return [];
    const filled = Array.from({ length: numPages }, (_, i) => aspects[i] ?? DEFAULT_PAGE_ASPECT);
    return computePageLayout(filled, pageWidth, PAGE_GAP, LAYER_PAD);
  }, [numPages, aspects, pageWidth]);

  const viewportHeight = containerRef.current?.clientHeight ?? 800;

  // Render window: the visible layer follows its own scroll; the hidden layer
  // pre-renders around the scroll position it will be promoted at.
  const anchor = visible ? scrollTop : initialScrollTop;
  const [first, last] = useMemo(
    () => visibleRange(anchor, viewportHeight, layout, visible ? viewportHeight : 0),
    [anchor, viewportHeight, layout, visible]
  );

  useImperativeHandle(
    ref,
    () => ({
      getScrollTop: () => containerRef.current?.scrollTop ?? 0,
      setScrollTop: (v: number) => {
        const el = containerRef.current;
        if (!el) return;
        el.scrollTop = clampScrollTop(v, el.scrollHeight, el.clientHeight);
      },
      scrollToPage: (index: number, smooth: boolean) => {
        const el = containerRef.current;
        const target = layout[index];
        if (!el || !target) return;
        el.scrollTo({ top: Math.max(0, target.top - PAGE_GAP), behavior: smooth ? 'smooth' : 'auto' });
      },
    }),
    [layout]
  );

  const handleScroll = useCallback(() => {
    if (!visible) return;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = containerRef.current;
      if (!el) return;
      setScrollTop(el.scrollTop);
      onPageInView?.(currentPageAt(el.scrollTop, el.clientHeight, layout));
    });
  }, [visible, layout, onPageInView]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  // Promotion: this layer was pre-rendering hidden and just became the active
  // one. Its DOM scrollTop was set imperatively during the hand-off — sync the
  // internal state so the render window and page indicator anchor correctly
  // before the first real scroll event.
  useEffect(() => {
    if (!visible) return;
    const el = containerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    onPageInView?.(currentPageAt(el.scrollTop, el.clientHeight, layout));
    // Only on the visibility flip — layout/callback identity churn must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      aria-hidden={!visible || undefined}
      // @ts-expect-error — `inert` is a valid DOM attribute; React's types lag.
      inert={!visible ? '' : undefined}
      className={cn(
        'absolute inset-0 overflow-auto overscroll-contain',
        // Hidden pre-render layer: invisible, inert. Fading layer: same, but
        // with a transition so it dissolves over the promoted one (the global
        // prefers-reduced-motion rule collapses the duration; the fade is also
        // skipped entirely at the call site under reduced motion).
        !visible && 'pointer-events-none opacity-0',
        fadingOut && 'transition-opacity duration-150'
      )}
      data-pdf-layer={visible ? 'active' : 'incoming'}
    >
      <Document
        file={url}
        options={HARDENED_PDF_OPTIONS}
        loading={null}
        error={null}
        onLoadSuccess={(doc) => {
          setNumPages(doc.numPages);
          onLoaded?.(gen);
          // Resolve real aspect ratios (fast post-parse); placeholders use the
          // US-Letter default meanwhile, which is exact for this app's output.
          void Promise.all(
            Array.from({ length: doc.numPages }, (_, i) =>
              doc
                .getPage(i + 1)
                .then((p) => {
                  const vp = p.getViewport({ scale: 1 });
                  return vp.width / vp.height;
                })
                .catch(() => DEFAULT_PAGE_ASPECT)
            )
          ).then((resolved) => setAspects(resolved));
          void doc
            .getPage(1)
            .then((p) => onDocMeta?.(gen, { numPages: doc.numPages, baseWidth: p.getViewport({ scale: 1 }).width }))
            .catch(() => onDocMeta?.(gen, { numPages: doc.numPages, baseWidth: pageWidth }));
          if (visible) onPageInView?.(1);
        }}
        onLoadError={() => onFailed?.(gen)}
        onSourceError={() => onFailed?.(gen)}
      >
        <div className="relative" style={{ height: contentHeight(layout, LAYER_PAD) }}>
          {layout.map((p, i) => {
            const inWindow = i >= first && i <= last;
            return (
              <div
                key={i}
                className="absolute inset-x-0 flex justify-center"
                style={{ top: p.top }}
              >
                <div
                  className="bg-white shadow-md ring-1 ring-black/5 dark:ring-white/10"
                  style={{ width: pageWidth, height: p.height }}
                >
                  {inWindow && (
                    <Page
                      pageNumber={i + 1}
                      width={pageWidth}
                      devicePixelRatio={dprCap}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      loading={null}
                      error={null}
                      onRenderSuccess={() => {
                        const pending = pendingRenderRef.current;
                        if (!pending) return;
                        pending.delete(i);
                        if (pending.size === 0) {
                          pendingRenderRef.current = null;
                          onReady?.(gen);
                        }
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Document>
      {/* Hidden-layer readiness bookkeeping: once the layout is known, record
          which restore-window pages must paint before promotion. */}
      {!visible && layout.length > 0 && pendingRenderRef.current === null && onReady && (
        <TrackPending firstIndex={first} lastIndex={last} pendingRef={pendingRenderRef} onEmpty={() => onReady(gen)} />
      )}
    </div>
  );
});

/** Initializes the pending-render set exactly once per (hidden) layer. Rendered
 *  as a null component so the initialization participates in the same commit
 *  as the first windowed <Page> mount. */
function TrackPending({
  firstIndex,
  lastIndex,
  pendingRef,
  onEmpty,
}: {
  firstIndex: number;
  lastIndex: number;
  pendingRef: React.MutableRefObject<Set<number> | null>;
  onEmpty: () => void;
}) {
  useEffect(() => {
    if (pendingRef.current !== null) return;
    const pending = new Set<number>();
    for (let i = firstIndex; i <= lastIndex; i++) pending.add(i);
    if (pending.size === 0) {
      onEmpty();
      return;
    }
    pendingRef.current = pending;
    // Pages already painted before this effect ran can't call back — but
    // onRenderSuccess always fires after mount, and this effect runs in the
    // same commit as the first windowed Page mount, so no callback is missed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default PdfPageLayer;
