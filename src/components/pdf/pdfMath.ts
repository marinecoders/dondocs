/**
 * Pure layout/zoom math for the PDF viewer. No DOM, no pdf.js — everything
 * here is deterministic and unit-tested (tests/unit/pdfViewerMath.test.ts).
 * The viewer deliberately derives its render window and page indicator from
 * scroll arithmetic instead of IntersectionObserver: one rAF-throttled scroll
 * handler, no observer lifecycle, and it runs under happy-dom.
 */

/** One page's vertical band inside the scroll content, in CSS px. */
export interface PageLayout {
  /** Top edge of the page (its gap is above it). */
  top: number;
  /** Page height only (no gap). */
  height: number;
}

/** US Letter width/height — the right placeholder aspect for this app. */
export const DEFAULT_PAGE_ASPECT = 8.5 / 11;

/** Discrete zoom stops; fit-width snaps into these when the user steps. */
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0] as const;

/**
 * Stack pages vertically: each page is pageWidth wide, height from its
 * width/height aspect ratio, `gap` between pages, `pad` above the first and
 * below the last.
 */
export function computePageLayout(
  aspects: readonly number[],
  pageWidth: number,
  gap: number,
  pad: number
): PageLayout[] {
  const layout: PageLayout[] = [];
  let top = pad;
  for (const aspect of aspects) {
    const height = pageWidth / (aspect > 0 ? aspect : DEFAULT_PAGE_ASPECT);
    layout.push({ top, height });
    top += height + gap;
  }
  return layout;
}

/** Total scrollable content height for a layout produced above (gaps are
 *  already baked into the layout's top offsets). */
export function contentHeight(layout: readonly PageLayout[], pad: number): number {
  if (layout.length === 0) return pad * 2;
  const last = layout[layout.length - 1];
  return last.top + last.height + pad;
}

/**
 * The inclusive [first, last] page-index range intersecting the viewport
 * extended by `overscanPx` in both directions. Pages outside this window are
 * rendered as fixed-size placeholders (their canvases unmount → memory freed).
 */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  layout: readonly PageLayout[],
  overscanPx: number
): [number, number] {
  if (layout.length === 0) return [0, -1];
  const windowTop = scrollTop - overscanPx;
  const windowBottom = scrollTop + viewportHeight + overscanPx;
  let first = layout.length - 1;
  let last = 0;
  for (let i = 0; i < layout.length; i++) {
    const p = layout[i];
    if (p.top + p.height >= windowTop && p.top <= windowBottom) {
      if (i < first) first = i;
      if (i > last) last = i;
    }
  }
  // Nothing intersects (scrolled past all content): clamp to the nearest page.
  if (first > last) {
    const nearest = scrollTop <= layout[0].top ? 0 : layout.length - 1;
    return [nearest, nearest];
  }
  return [first, last];
}

/**
 * 1-based page number whose band covers the viewport's vertical center —
 * drives the "N of M" indicator.
 */
export function currentPage(
  scrollTop: number,
  viewportHeight: number,
  layout: readonly PageLayout[]
): number {
  if (layout.length === 0) return 1;
  const center = scrollTop + viewportHeight / 2;
  for (let i = 0; i < layout.length; i++) {
    const p = layout[i];
    // A page "owns" the band from its top to the next page's top (the gap
    // below it counts as its territory, so the indicator never flickers to
    // "no page" between pages).
    const bandEnd = i + 1 < layout.length ? layout[i + 1].top : Infinity;
    if (center >= p.top && center < bandEnd) return i + 1;
  }
  return center < layout[0].top ? 1 : layout.length;
}

/**
 * The next discrete zoom stop from an arbitrary effective scale (fit-width
 * produces non-step scales). Stepping up from a value between stops snaps to
 * the next stop above it; stepping down snaps below. Clamped at the ends.
 */
export function nextZoomStep(effectiveScale: number, dir: 1 | -1): number {
  if (dir === 1) {
    for (const step of ZOOM_STEPS) {
      if (step > effectiveScale + 1e-6) return step;
    }
    return ZOOM_STEPS[ZOOM_STEPS.length - 1];
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < effectiveScale - 1e-6) return ZOOM_STEPS[i];
  }
  return ZOOM_STEPS[0];
}

/** Clamp a saved scrollTop into a container's valid scroll range. */
export function clampScrollTop(saved: number, scrollHeight: number, clientHeight: number): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.min(Math.max(0, saved), max);
}

/**
 * Re-anchor scrollTop after the content height changes (zoom / fit-width
 * resize): keep the point at the viewport's center at the center.
 */
export function rescaleScrollTop(
  scrollTop: number,
  viewportHeight: number,
  oldContentHeight: number,
  newContentHeight: number
): number {
  if (oldContentHeight <= 0) return 0;
  const center = scrollTop + viewportHeight / 2;
  const ratio = center / oldContentHeight;
  const newCenter = ratio * newContentHeight;
  return Math.max(0, newCenter - viewportHeight / 2);
}
