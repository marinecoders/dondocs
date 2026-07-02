import { useCallback, useEffect, useRef, useState } from 'react';
import { nextZoomStep, DEFAULT_PAGE_ASPECT } from './pdfMath';

/**
 * Zoom state for the viewer. Fit-width is the resting mode: the page tracks
 * the container (ResizeObserver, rAF-coalesced) up to a hard cap so a wide
 * desktop panel doesn't blow a letter page up to poster size. Fit-page sizes
 * the page so the whole sheet is visible — the "judge the composition" view.
 * Stepping the zoom converts the current *effective* scale into the nearest
 * discrete stop and switches to manual; either fit button returns to tracking.
 */

export type ZoomMode = { kind: 'fit-width' } | { kind: 'fit-page' } | { kind: 'manual'; scale: number };

/** Horizontal padding of the mat around the page, per side. */
export const MAT_PAD = 24;
/** Fit modes never render wider than this (matches the old mobile cap). */
export const MAX_FIT_WIDTH = 960;

/**
 * `contentRef` must be the element that actually holds the pages — the layer
 * column, NOT the viewer root. The root doesn't shrink when the thumbnail
 * rail opens, so observing it renders pages wider than the space they live in
 * (negative margins + horizontal scroll — caught in the live geometry scan).
 */
export function usePdfZoom(
  contentRef: React.RefObject<HTMLElement | null>,
  basePageCssWidth: number | null,
  basePageAspect: number | null
) {
  const [mode, setMode] = useState<ZoomMode>({ kind: 'fit-width' });
  const [box, setBox] = useState({ width: 0, height: 0 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect) return;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setBox({ width: rect.width, height: rect.height }));
    });
    ro.observe(el);
    setBox({ width: el.clientWidth, height: el.clientHeight });
    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [contentRef]);

  const aspect = basePageAspect ?? DEFAULT_PAGE_ASPECT;
  const clampWidth = (w: number) => Math.min(Math.max(w, 120), MAX_FIT_WIDTH);
  const fitWidth = clampWidth(box.width - MAT_PAD * 2);
  // Whole page visible: constrained by BOTH dimensions — the content column's
  // height (it already excludes the toolbar) sets the ceiling, but a narrow
  // column still wins (a height-only fit would exceed the container and force
  // horizontal scroll, defeating the point of the mode).
  const fitPageWidth = clampWidth(
    Math.min((box.height - MAT_PAD * 2) * aspect, box.width - MAT_PAD * 2)
  );

  const widthFor = useCallback(
    (m: ZoomMode): number => {
      if (m.kind === 'fit-width') return fitWidth;
      if (m.kind === 'fit-page') return fitPageWidth;
      return Math.round((basePageCssWidth ?? fitWidth) * m.scale);
    },
    [fitWidth, fitPageWidth, basePageCssWidth]
  );

  const pageWidth = widthFor(mode);
  // The scale the current pageWidth corresponds to — the % readout, and the
  // starting point when stepping out of either fit mode.
  const effectiveScale = basePageCssWidth ? pageWidth / basePageCssWidth : 1;

  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      setMode((prev) => {
        const base = basePageCssWidth ?? fitWidth;
        const current = widthFor(prev) / base;
        return { kind: 'manual', scale: nextZoomStep(current, dir) };
      });
    },
    [basePageCssWidth, fitWidth, widthFor]
  );

  const zoomFitWidth = useCallback(() => setMode({ kind: 'fit-width' }), []);
  const zoomFitPage = useCallback(() => setMode({ kind: 'fit-page' }), []);

  return { mode, pageWidth, effectiveScale, zoomStep, zoomFitWidth, zoomFitPage };
}
