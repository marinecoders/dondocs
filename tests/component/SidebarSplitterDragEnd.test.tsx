// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { createRef } from 'react';

import { SidebarSplitter } from '@/components/layout/SidebarSplitter';
import { useUIStore } from '@/stores/uiStore';

/**
 * A drag has to end even when the pointer never says so.
 *
 * Both ways it can go silent were reachable: the browser takes the gesture and
 * sends pointercancel instead of pointerup, or the button is released outside
 * the window, where nothing is delivered at all. Either left the drag live —
 * the panel then tracked the cursor with no button held, behind an overlay that
 * swallowed every click until the user happened to click again.
 */

/** happy-dom lays nothing out, so every rect is zero — and a zero-height
 *  container makes resolveSplitDrag clamp every position to the same floor,
 *  which would make these assertions pass no matter what the code did. Give
 *  the outline a real box and the sidebar a real height. */
function stubGeometry(outline: HTMLElement) {
  const rect = (height: number, top = 0) => () =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 200, x: 0, y: top }) as DOMRect;
  outline.getBoundingClientRect = rect(300);
  outline.parentElement!.getBoundingClientRect = rect(700);
}

function mount() {
  const outlineRef = createRef<HTMLDivElement>();
  render(
    <div>
      {/* Stands in for the sidebar column the splitter measures against. */}
      <div ref={outlineRef} />
      <SidebarSplitter outlineRef={outlineRef} />
    </div>
  );
  stubGeometry(outlineRef.current!);
  return screen.getByRole('separator');
}

const pointer = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init });

/** Press, then drag far enough down that the height is pinned to the ceiling. */
function startDrag(handle: HTMLElement) {
  act(() => {
    handle.dispatchEvent(pointer('pointerdown', { buttons: 1, clientY: 0 }));
  });
  act(() => {
    document.dispatchEvent(pointer('pointermove', { buttons: 1, clientY: 400 }));
  });
}

/** Move with nothing held — what the page sees once the pointer comes back. */
function moveWithNoButton(y: number) {
  act(() => {
    document.dispatchEvent(pointer('pointermove', { buttons: 0, clientY: y }));
  });
}

describe('a drag that never reports its end', () => {
  beforeEach(() => {
    useUIStore.setState({ outlineHeight: null });
  });

  it('stops resizing after the browser cancels the gesture', () => {
    const handle = mount();
    startDrag(handle);
    const whileDragging = useUIStore.getState().outlineHeight;
    expect(whileDragging).not.toBeNull();

    act(() => {
      document.dispatchEvent(pointer('pointercancel'));
    });
    moveWithNoButton(50);

    expect(useUIStore.getState().outlineHeight).toBe(whileDragging);
  });

  it('stops resizing after the button is released off-window', () => {
    const handle = mount();
    startDrag(handle);
    const whileDragging = useUIStore.getState().outlineHeight;

    // No pointerup, no pointercancel — the release simply never arrived.
    moveWithNoButton(50);
    const afterRelease = useUIStore.getState().outlineHeight;
    moveWithNoButton(120);

    expect(afterRelease).toBe(whileDragging);
    expect(useUIStore.getState().outlineHeight).toBe(whileDragging);
  });
});
