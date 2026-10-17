import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore, SIDEBAR_WIDTH } from '@/stores/uiStore';

describe('sidebarWidth in the store', () => {
  beforeEach(() => {
    useUIStore.setState({ sidebarWidth: SIDEBAR_WIDTH.default, sidebarCollapsed: false });
  });

  it('starts with the prototype workspace width', () => {
    // Stored user widths remain independent of the new workspace default.
    expect(useUIStore.getState().sidebarWidth).toBe(208);
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
