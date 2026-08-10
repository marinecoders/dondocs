import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore, SIDEBAR_WIDTH, resolveSidebarDrag } from '@/stores/uiStore';

/**
 * The drag handle on the sidebar's right edge.
 *
 * Sized and keyed like ResizableDivider next to the preview, so the two edges of
 * the workspace behave the same way — that symmetry is the point of this
 * component existing.
 */
export function SidebarResizer() {
  const width = useUIStore((s) => s.sidebarWidth);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const setWidth = useUIStore((s) => s.setSidebarWidth);
  const setCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const [isDragging, setIsDragging] = useState(false);
  // The overlay only belongs over the page once the pointer has actually
  // moved. Mounted on pointerdown it swallowed the mouseup, so the press
  // never became a click and the dblclick reset never fired.
  const [moved, setMoved] = useState(false);
  // The width to come back to. A drag that ends collapsed passes through every
  // width on its way in, and without this the last frame before the snap — a
  // width nobody chose — would be what reopening restores.
  const widthBeforeDrag = useRef(width);

  const apply = useCallback(
    (x: number) => {
      const next = resolveSidebarDrag(x);
      setCollapsed(next.collapsed);
      if (next.width !== undefined) setWidth(next.width);
    },
    [setCollapsed, setWidth],
  );

  // No preventDefault here: it suppresses the compatibility mouse events, and
  // with them the dblclick that resets the width — which is why that reset had
  // never actually worked. Selection is held off with select-none on the handle
  // and user-select on the body while dragging.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      widthBeforeDrag.current = width;
      setIsDragging(true);
    },
    [width],
  );

  useEffect(() => {
    if (!isDragging) return;

    // The sidebar starts at the viewport's left edge, so clientX is the width.
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      setMoved(true);
      apply(e.clientX);
    };
    const onUp = () => {
      setIsDragging(false);
      setMoved(false);
      // Landed collapsed: put back the width the drag started from, so
      // reopening returns to what the user had rather than to the last
      // width the pointer happened to cross.
      if (useUIStore.getState().sidebarCollapsed) setWidth(widthBeforeDrag.current);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [isDragging, apply, setWidth]);

  const current = collapsed ? SIDEBAR_WIDTH.collapsed : width;

  return (
    <>
      {/* Keeps pointer events off the PDF iframe mid-drag. */}
      {isDragging && moved && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      <div
        onPointerDown={handlePointerDown}
        onDoubleClick={() => {
          setCollapsed(false);
          setWidth(SIDEBAR_WIDTH.default);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const step = e.key === 'ArrowRight' ? 16 : -16;
          // Arrowing left off the minimum collapses, mirroring the drag.
          if (collapsed) {
            if (step > 0) setCollapsed(false);
            return;
          }
          if (step < 0 && width + step < SIDEBAR_WIDTH.min) {
            setCollapsed(true);
            return;
          }
          setWidth(width + step);
        }}
        /* z-20, one step above the editor column's own z-10: its section shells
           use negative margins that reach over this strip, and at equal z the
           later sibling won, so half the grab area was dead. Still far below
           the z-50 overlays. */
        className="group relative z-20 hidden shrink-0 cursor-col-resize select-none rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:block"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar. Drag, or use the left and right arrow keys."
        aria-valuenow={current}
        aria-valuemin={SIDEBAR_WIDTH.collapsed}
        aria-valuemax={SIDEBAR_WIDTH.max}
        tabIndex={0}
      >
        {/* The line stays a hairline; the grab target is 16px wide, matching
            the preview divider. A 1px target is not reliably hittable — the
            edge looked right and could not be picked up. */}
        <div className="absolute inset-y-0 -left-2 -right-2" />
        <div
          className={`h-full w-px transition-colors ${
            isDragging ? 'bg-primary' : 'bg-border group-hover:bg-primary/50'
          }`}
        />
      </div>
    </>
  );
}
