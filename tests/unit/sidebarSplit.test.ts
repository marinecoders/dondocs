/**
 * The sidebar's other axis: how its height is split between the section outline
 * and Recents.
 *
 * The outline used to be rigid — content height, no scroll, no shrink — so a
 * short window took the whole shortfall out of Recents. At a 500px window that
 * left Recents 40px with its search box scrolled out of sight, while the
 * outline kept all 387 of its pixels.
 *
 * `resolveSplitDrag` is where the clamping lives, kept pure so the floors are
 * checked here rather than through a synthetic drag. Note the ceiling is a
 * function of the container, not a constant: it moves with the window.
 */
import { describe, it, expect } from 'vitest';
import { useUIStore, SIDEBAR_SPLIT, resolveSplitDrag } from '@/stores/uiStore';

// A sidebar 700px tall whose outline starts at y=100, the shape of the real one.
const TOP = 100;
const HEIGHT = 700;
const at = (y: number) => resolveSplitDrag(y, TOP, HEIGHT);

describe('resolveSplitDrag', () => {
  it('measures from the outline top, not the viewport', () => {
    expect(at(TOP + 300)).toBe(300);
  });

  it('holds the outline at its floor when dragged up past it', () => {
    expect(at(TOP + 10)).toBe(SIDEBAR_SPLIT.minOutline);
    expect(at(TOP - 500)).toBe(SIDEBAR_SPLIT.minOutline);
  });

  it('leaves Recents its floor when dragged down past it', () => {
    const ceiling = HEIGHT - SIDEBAR_SPLIT.minRecents;
    expect(at(TOP + HEIGHT)).toBe(ceiling);
    expect(at(TOP + 100_000)).toBe(ceiling);
    // What Recents is left with is exactly its floor, never less.
    expect(HEIGHT - at(TOP + 100_000)).toBe(SIDEBAR_SPLIT.minRecents);
  });

  it('moves the ceiling with the container rather than fixing it', () => {
    // The same drag in a shorter sidebar has to stop sooner, which is what
    // keeps a resized window from crushing Recents.
    expect(resolveSplitDrag(TOP + 600, TOP, 700)).toBe(560);
    expect(resolveSplitDrag(TOP + 600, TOP, 400)).toBe(260);
  });

  it('keeps the outline floor when the container cannot honour both', () => {
    // Sidebar too short for outline floor + Recents floor: the outline's floor
    // wins, so the controls at the top never vanish entirely.
    const tiny = SIDEBAR_SPLIT.minOutline + SIDEBAR_SPLIT.minRecents - 50;
    expect(resolveSplitDrag(TOP + 1000, TOP, tiny)).toBe(SIDEBAR_SPLIT.minOutline);
  });
});

describe('outlineHeight', () => {
  it('defaults to fitting the content', () => {
    expect(useUIStore.getState().outlineHeight).toBeNull();
  });

  it('takes null back as a reset, and floors any number it is given', () => {
    const { setOutlineHeight } = useUIStore.getState();

    setOutlineHeight(300);
    expect(useUIStore.getState().outlineHeight).toBe(300);

    setOutlineHeight(10);
    expect(useUIStore.getState().outlineHeight).toBe(SIDEBAR_SPLIT.minOutline);

    setOutlineHeight(null);
    expect(useUIStore.getState().outlineHeight).toBeNull();
  });
});
