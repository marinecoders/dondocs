import { useCallback, useEffect, useState } from 'react';
import { useUIStore, SIDEBAR_SPLIT, resolveSplitDrag } from '@/stores/uiStore';

/**
 * The drag handle between the section outline and Recents.
 *
 * The horizontal twin of SidebarResizer — same hairline, same 16px grab area,
 * same keyboard step — so both of the sidebar's dividers behave the same way.
 * It also draws the line that used to be the outline's bottom border.
 */
export function SidebarSplitter({
  outlineRef,
}: {
  outlineRef: React.RefObject<HTMLDivElement | null>;
}) {
  const height = useUIStore((s) => s.outlineHeight);
  const setHeight = useUIStore((s) => s.setOutlineHeight);
  const [isDragging, setIsDragging] = useState(false);
  // The overlay only belongs over the page once the pointer has actually
  // moved. Mounted on pointerdown it swallowed the mouseup, so the press
  // never became a click and the dblclick reset never fired.
  const [moved, setMoved] = useState(false);

  /** The outline's box and the room it has to move in, read at the moment it
   *  is needed: both change with the window, and neither is worth storing. */
  const geometry = useCallback(() => {
    const el = outlineRef.current;
    const container = el?.parentElement;
    if (!el || !container) return null;
    return {
      top: el.getBoundingClientRect().top,
      rendered: el.getBoundingClientRect().height,
      containerHeight: container.getBoundingClientRect().height,
    };
  }, [outlineRef]);

  // No preventDefault here: it suppresses the compatibility mouse events, and
  // with them the dblclick that resets the split. Selection is held off with
  // select-none on the handle and user-select on the body while dragging.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      // A release outside the window is never delivered to the page, so without
      // this the drag stays live: the panel follows the cursor with nothing
      // held and the overlay keeps swallowing clicks. The next move is where
      // we find out the button is gone.
      if (e.buttons === 0) {
        onUp();
        return;
      }
      setMoved(true);
      const g = geometry();
      if (g) setHeight(resolveSplitDrag(e.clientY, g.top, g.containerHeight));
    };
    const onUp = () => {
      setIsDragging(false);
      setMoved(false);
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    // The browser can take the gesture instead of ending it — a touch that
    // becomes a scroll, an interrupted drag. No pointerup follows.
    document.addEventListener('pointercancel', onUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
  }, [isDragging, geometry, setHeight]);

  return (
    <>
      {/* Keeps pointer events off the PDF iframe mid-drag. */}
      {isDragging && moved && <div className="fixed inset-0 z-50 cursor-row-resize" />}
      <div
        onPointerDown={handlePointerDown}
        // Back to fitting the outline's content.
        onDoubleClick={() => setHeight(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const box = geometry();
          if (!box) return;
          // Seeded from the rendered height, so the first press from the
          // content-fitting default moves from where the line actually is.
          const from = height ?? box.rendered;
          setHeight(
            resolveSplitDrag(
              box.top + from + (e.key === 'ArrowDown' ? 16 : -16),
              box.top,
              box.containerHeight
            )
          );
        }}
        className="group relative z-20 shrink-0 cursor-row-resize select-none rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the section outline. Drag, or use the up and down arrow keys."
        /* Only once a height has been chosen: until then it fits its content,
           and there is no value to report. */
        aria-valuenow={height ?? undefined}
        aria-valuemin={SIDEBAR_SPLIT.minOutline}
        tabIndex={0}
      >
        {/* Hairline with a 16px grab target above and below it, matching the
            width handle — a 1px target is not reliably hittable. */}
        <div className="absolute inset-x-0 -top-2 -bottom-2" />
        <div
          className={`h-px w-full transition-colors ${
            isDragging ? 'bg-primary' : 'bg-border group-hover:bg-primary/50'
          }`}
        />
      </div>
    </>
  );
}
