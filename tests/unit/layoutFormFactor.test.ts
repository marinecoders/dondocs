import { describe, it, expect } from 'vitest';
import { prefersMobileLayout, readLayoutEnvironment } from '@/utils/device/layout';

describe('which layout a viewport gets', () => {
  it('keeps a touchscreen laptop on the desktop layout', () => {
    // 1920x1200 at 150%, or 2560x1600 at 200%: under the old 1366 threshold,
    // and reporting touch. Windows is not a mobile platform.
    expect(prefersMobileLayout({ width: 1280, isIPad: false, isMobilePlatform: false })).toBe(false);
  });

  it('keeps a plain laptop on the desktop layout', () => {
    expect(prefersMobileLayout({ width: 1440, isIPad: false, isMobilePlatform: false })).toBe(false);
  });

  it('gives a phone the mobile layout', () => {
    expect(prefersMobileLayout({ width: 390, isIPad: false, isMobilePlatform: true })).toBe(true);
  });

  it('gives a tablet the mobile layout', () => {
    expect(prefersMobileLayout({ width: 1024, isIPad: false, isMobilePlatform: true })).toBe(true);
  });

  it('gives an iPad the mobile layout at any width', () => {
    // The embedded PDF preview does not work there, whatever the size.
    expect(prefersMobileLayout({ width: 1366, isIPad: true, isMobilePlatform: false })).toBe(true);
    expect(prefersMobileLayout({ width: 1920, isIPad: true, isMobilePlatform: false })).toBe(true);
  });

  it('gives any phone-width window the mobile layout, platform aside', () => {
    // A desktop window dragged this narrow has no room for the sidebar either.
    expect(prefersMobileLayout({ width: 500, isIPad: false, isMobilePlatform: false })).toBe(true);
  });

  it('holds the tablet boundary at 1366', () => {
    expect(prefersMobileLayout({ width: 1365, isIPad: false, isMobilePlatform: true })).toBe(true);
    expect(prefersMobileLayout({ width: 1366, isIPad: false, isMobilePlatform: true })).toBe(false);
  });
});

// The half that reads the browser. It is where the platform signal and the
// iPad heuristic actually live, so testing only the pure rule above would
// leave the reading of them unproven — which is how the original shipped.
describe('reading the layout environment from the window', () => {
  const withWindow = <T>(
    opts: { width: number; ua: string; touchPoints?: number; uaDataMobile?: boolean },
    body: () => T,
  ): T => {
    const original = {
      ua: Object.getOwnPropertyDescriptor(navigator, 'userAgent'),
      touch: Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints'),
      uaData: Object.getOwnPropertyDescriptor(navigator, 'userAgentData'),
      width: window.innerWidth,
    };
    Object.defineProperty(window, 'innerWidth', { value: opts.width, configurable: true });
    Object.defineProperty(navigator, 'userAgent', { value: opts.ua, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: opts.touchPoints ?? 0, configurable: true });
    Object.defineProperty(navigator, 'userAgentData', {
      value: opts.uaDataMobile === undefined ? undefined : { mobile: opts.uaDataMobile },
      configurable: true,
    });
    try {
      return body();
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: original.width, configurable: true });
      if (original.ua) Object.defineProperty(navigator, 'userAgent', original.ua);
      if (original.touch) Object.defineProperty(navigator, 'maxTouchPoints', original.touch);
      if (original.uaData) Object.defineProperty(navigator, 'userAgentData', original.uaData);
    }
  };

  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';
  const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';
  const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';

  it('does not call a touchscreen laptop a mobile platform', () => {
    // The reported bug: ten touch points and a viewport under 1366.
    const env = withWindow(
      { width: 1280, ua: WINDOWS, touchPoints: 10, uaDataMobile: false },
      readLayoutEnvironment,
    );
    expect(env.isMobilePlatform).toBe(false);
    expect(env.isIPad).toBe(false);
    expect(prefersMobileLayout(env)).toBe(false);
  });

  it('still calls an Android tablet mobile, though Chromium reports it as not', () => {
    // userAgentData.mobile is false for tablets; the user agent still says Android.
    const env = withWindow(
      { width: 1024, ua: ANDROID_TABLET, touchPoints: 5, uaDataMobile: false },
      readLayoutEnvironment,
    );
    expect(env.isMobilePlatform).toBe(true);
    expect(prefersMobileLayout(env)).toBe(true);
  });

  it('recognises an iPad in desktop mode, which reports itself as a Mac', () => {
    // Desktop mode suppresses `ontouchstart`; maxTouchPoints is what remains.
    const env = withWindow({ width: 1366, ua: IPAD_DESKTOP, touchPoints: 5 }, readLayoutEnvironment);
    expect(env.isIPad).toBe(true);
    expect(prefersMobileLayout(env)).toBe(true);
  });

  it('does not mistake a Mac for an iPad', () => {
    const env = withWindow({ width: 1440, ua: IPAD_DESKTOP, touchPoints: 0 }, readLayoutEnvironment);
    expect(env.isIPad).toBe(false);
    expect(prefersMobileLayout(env)).toBe(false);
  });

  it('falls back to the user agent where userAgentData is unavailable', () => {
    // Safari and Firefox ship no userAgentData at all.
    const env = withWindow({ width: 1280, ua: WINDOWS, touchPoints: 10 }, readLayoutEnvironment);
    expect(env.isMobilePlatform).toBe(false);
    expect(prefersMobileLayout(env)).toBe(false);
  });
});
