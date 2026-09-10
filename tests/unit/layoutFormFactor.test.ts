import { describe, it, expect } from 'vitest';
import { prefersMobileLayout, readLayoutEnvironment } from '@/utils/device/layout';

describe('which layout a viewport gets', () => {
  const laptop = { width: 1280, isIPad: false, touchPrimary: false };

  it('keeps a touchscreen laptop on the desktop layout', () => {
    // 1920x1200 at 150%, or 2560x1600 at 200%: under the old 1366 threshold,
    // and reporting touch. It has a trackpad, so a fine pointer exists.
    expect(prefersMobileLayout(laptop)).toBe(false);
  });

  it('keeps a plain laptop on the desktop layout', () => {
    expect(prefersMobileLayout({ width: 1440, isIPad: false, touchPrimary: false })).toBe(false);
  });

  it('gives a phone the mobile layout', () => {
    expect(prefersMobileLayout({ width: 390, isIPad: false, touchPrimary: true })).toBe(true);
  });

  it('gives a tablet the mobile layout', () => {
    // Touch, and nothing fine behind it.
    expect(prefersMobileLayout({ width: 1024, isIPad: false, touchPrimary: true })).toBe(true);
  });

  it('gives an iPad the mobile layout at any width', () => {
    // The embedded PDF preview does not work there, whatever the size.
    expect(prefersMobileLayout({ width: 1366, isIPad: true, touchPrimary: true })).toBe(true);
    expect(prefersMobileLayout({ width: 1920, isIPad: true, touchPrimary: false })).toBe(true);
  });

  it('gives any phone-width window the mobile layout, touch or not', () => {
    // A desktop window dragged this narrow has no room for the sidebar either.
    expect(prefersMobileLayout({ width: 500, isIPad: false, touchPrimary: false })).toBe(true);
  });

  it('does not put a large tablet with a trackpad on the mobile layout', () => {
    // A Surface with its keyboard attached, or an Android tablet with a mouse:
    // a fine pointer is available, so it is driven like a laptop.
    expect(prefersMobileLayout({ width: 1280, isIPad: false, touchPrimary: false })).toBe(false);
  });

  it('holds the tablet boundary at 1366', () => {
    expect(prefersMobileLayout({ width: 1365, isIPad: false, touchPrimary: true })).toBe(true);
    expect(prefersMobileLayout({ width: 1366, isIPad: false, touchPrimary: true })).toBe(false);
  });
});

// The half that touches browser APIs. It is where the pointer queries and the
// iPad heuristic actually live, so testing only the pure rule above would leave
// the reading of them unproven — which is how the original shipped.
describe('reading the layout environment from the window', () => {
  const withWindow = (opts: { width: number; ua: string; coarse: boolean; fine: boolean; touchPoints?: number }) => {
    const original = {
      matchMedia: window.matchMedia,
      ua: Object.getOwnPropertyDescriptor(navigator, 'userAgent'),
      touch: Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints'),
      width: window.innerWidth,
    };
    Object.defineProperty(window, 'innerWidth', { value: opts.width, configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: opts.ua, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: opts.touchPoints ?? 0, configurable: true });
    window.matchMedia = ((q: string) => ({
      matches: q.includes('any-pointer: fine') ? opts.fine : opts.coarse,
    })) as unknown as typeof window.matchMedia;
    try {
      return readLayoutEnvironment();
    } finally {
      window.matchMedia = original.matchMedia;
      Object.defineProperty(window, 'innerWidth', { value: original.width, configurable: true });
      if (original.ua) Object.defineProperty(navigator, 'userAgent', original.ua);
      if (original.touch) Object.defineProperty(navigator, 'maxTouchPoints', original.touch);
    }
  };

  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';
  const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';

  it('does not call a touchscreen laptop touch-primary', () => {
    // The reported bug: touch panel present, trackpad present.
    const env = withWindow({ width: 1280, ua: WINDOWS, coarse: true, fine: true, touchPoints: 10 });
    expect(env.touchPrimary).toBe(false);
    expect(prefersMobileLayout(env)).toBe(false);
  });

  it('calls a tablet touch-primary', () => {
    const env = withWindow({ width: 1024, ua: WINDOWS, coarse: true, fine: false, touchPoints: 5 });
    expect(env.touchPrimary).toBe(true);
    expect(prefersMobileLayout(env)).toBe(true);
  });

  it('recognises an iPad in desktop mode, which reports itself as a Mac', () => {
    // Desktop mode suppresses `ontouchstart`; maxTouchPoints is what remains.
    const env = withWindow({ width: 1366, ua: IPAD_DESKTOP, coarse: false, fine: true, touchPoints: 5 });
    expect(env.isIPad).toBe(true);
    expect(prefersMobileLayout(env)).toBe(true);
  });

  it('does not mistake a Mac for an iPad', () => {
    const env = withWindow({ width: 1440, ua: IPAD_DESKTOP, coarse: false, fine: true, touchPoints: 0 });
    expect(env.isIPad).toBe(false);
    expect(prefersMobileLayout(env)).toBe(false);
  });

  it('falls back to the desktop layout when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing the API to prove the guard holds
    delete window.matchMedia;
    try {
      expect(readLayoutEnvironment().touchPrimary).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});
