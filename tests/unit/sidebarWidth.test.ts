/**
 * Sidebar sizing, including the part that makes collapsing feel like one gesture.
 *
 * The sidebar used to be a hard-coded 248px with a separate collapsed rail — 19%
 * of a 1280px screen or nothing, no middle. It is now a continuous width, and
 * the rail is the bottom of that range: drag past the threshold and it snaps
 * shut, drag back out and the width you had returns.
 *
 * `resolveSidebarDrag` is where that decision lives, kept pure so it is checked
 * here rather than through a synthetic drag.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore, SIDEBAR_WIDTH, resolveSidebarDrag } from '@/stores/uiStore';

describe('resolveSidebarDrag', () => {
  it('collapses below the snap threshold', () => {
    expect(resolveSidebarDrag(SIDEBAR_WIDTH.snapThreshold - 1).collapsed).toBe(true);
    expect(resolveSidebarDrag(0).collapsed).toBe(true);
  });

  it('does not report a width when it collapses', () => {
    // The stored width is left alone, which is what lets dragging back out
    // restore it rather than snapping to the minimum.
    expect(resolveSidebarDrag(10).width).toBeUndefined();
  });

  it('stays open at and above the threshold', () => {
    expect(resolveSidebarDrag(SIDEBAR_WIDTH.snapThreshold).collapsed).toBe(false);
  });

  it('clamps to the minimum between the threshold and the minimum width', () => {
    // 160–200px is the hysteresis band: open, but never narrower than min.
    expect(resolveSidebarDrag(SIDEBAR_WIDTH.snapThreshold).width).toBe(SIDEBAR_WIDTH.min);
    expect(resolveSidebarDrag(SIDEBAR_WIDTH.min - 20).width).toBe(SIDEBAR_WIDTH.min);
  });

  it('tracks the pointer between the bounds', () => {
    expect(resolveSidebarDrag(300).width).toBe(300);
    expect(resolveSidebarDrag(SIDEBAR_WIDTH.max).width).toBe(SIDEBAR_WIDTH.max);
  });

  it('clamps to the maximum so the editor column stays usable', () => {
    expect(resolveSidebarDrag(SIDEBAR_WIDTH.max + 500).width).toBe(SIDEBAR_WIDTH.max);
  });
});

describe('sidebarWidth in the store', () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarWidth: SIDEBAR_WIDTH.default, sidebarCollapsed: false });
  });

  it('starts at the width the sidebar was hard-coded to', () => {
    // An existing user sees nothing move until they drag it.
    expect(useUIStore.getState().sidebarWidth).toBe(248);
  });

  it('clamps whatever it is handed', () => {
    useUIStore.getState().setSidebarWidth(10_000);
    expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH.max);
    useUIStore.getState().setSidebarWidth(-5);
    expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH.min);
  });

  it('keeps the width while collapsed so expanding restores it', () => {
    useUIStore.getState().setSidebarWidth(380);
    useUIStore.getState().setSidebarCollapsed(true);
    expect(useUIStore.getState().sidebarWidth).toBe(380);
    useUIStore.getState().setSidebarCollapsed(false);
    expect(useUIStore.getState().sidebarWidth).toBe(380);
  });

  it('leaves room for the editor at the widest setting on a 1280 screen', () => {
    // 420 sidebar + a 20%-min preview still leaves the editor over 500px.
    const editor = 1280 - SIDEBAR_WIDTH.max - 1280 * 0.2;
    expect(editor).toBeGreaterThan(500);
  });
});
