import { useCallback, useEffect, useRef, useState } from 'react';
import { nextZoomStep } from './pdfMath';

/**
 * Zoom state for the viewer. Fit-width is the resting mode: the page tracks
 * the container (ResizeObserver, rAF-coalesced) up to a hard cap so a wide
 * desktop panel doesn't blow a letter page up to poster size. Stepping the
 * zoom converts the current *effective* scale into the nearest discrete stop
 * and switches to manual; "fit" returns to tracking.
 */

export type ZoomMode = { kind: 'fit-width' } | { kind: 'manual'; scale: number };

/** Horizontal padding of the mat around the page, per side. */
export const MAT_PAD = 24;
/** Fit-width never renders wider than this (matches the old mobile cap). */
export const MAX_FIT_WIDTH = 960;

export function usePdfZoom(rootRef: React.RefObject<HTMLElement | null>, basePageCssWidth: number | null) {
  const [mode, setMode] = useState<ZoomMode>({ kind: 'fit-width' });
  const [containerWidth, setContainerWidth] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setContainerWidth(width));
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [rootRef]);

  const fitWidth = Math.min(Math.max(containerWidth - MAT_PAD * 2, 120), MAX_FIT_WIDTH);
  const pageWidth =
    mode.kind === 'fit-width'
      ? fitWidth
      : Math.round((basePageCssWidth ?? fitWidth) * mode.scale);

  // The scale the current pageWidth corresponds to, for the % readout and as
  // the starting point when stepping out of fit-width.
  const effectiveScale = basePageCssWidth ? pageWidth / basePageCssWidth : 1;

  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      setMode((prev) => {
        const base = basePageCssWidth ?? fitWidth;
        const current = prev.kind === 'manual' ? prev.scale : fitWidth / base;
        return { kind: 'manual', scale: nextZoomStep(current, dir) };
      });
    },
    [basePageCssWidth, fitWidth]
  );

  const zoomFit = useCallback(() => setMode({ kind: 'fit-width' }), []);

  return { mode, pageWidth, effectiveScale, zoomStep, zoomFit };
}
