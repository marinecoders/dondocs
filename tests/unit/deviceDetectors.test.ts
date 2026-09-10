import { describe, it, expect, afterEach } from 'vitest';
import { detectMobile, detectIPad, detectMobileUserAgent } from '@/utils/device/detectors';

const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36';

/** Stand the window up as the device under test would report it. */
function asDevice(opts: { width?: number; touchPoints?: number; touchEvent?: boolean }) {
  Object.defineProperty(window, 'innerWidth', { value: opts.width ?? 1280, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: opts.touchPoints ?? 0, configurable: true });
  if (opts.touchEvent) {
    (window as unknown as Record<string, unknown>).ontouchstart = null;
  } else {
    delete (window as unknown as Record<string, unknown>).ontouchstart;
  }
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).ontouchstart;
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
});

describe('detectMobile', () => {
  // This decides the PDF delivery path, the install prompt and the welcome
  // modal. It used to answer "has touch and a window under 1024px" as a
  // fallback, so a touchscreen Windows laptop with its window snapped to half
  // a screen was handed all three of those as if it were a phone.
  it('does not call a touchscreen laptop mobile, at any window width', () => {
    asDevice({ width: 640, touchPoints: 10, touchEvent: true });
    expect(detectMobile(WINDOWS)).toBe(false);
  });

  it('calls a phone mobile', () => {
    asDevice({ width: 390, touchPoints: 5, touchEvent: true });
    expect(detectMobile(IPHONE)).toBe(true);
    expect(detectMobile(ANDROID)).toBe(true);
  });

  it('calls an iPad mobile, including in desktop mode where it claims to be a Mac', () => {
    asDevice({ width: 1366, touchPoints: 5 });
    expect(detectMobile(IPAD)).toBe(true);
    // Desktop mode: a Mac user agent, no touch events, but touch points remain.
    // The old width-based fallback missed this — an iPad in landscape is wider
    // than the 1024px it tested.
    expect(detectMobile(MAC)).toBe(true);
  });

  it('does not call a Mac mobile', () => {
    asDevice({ width: 1440, touchPoints: 0 });
    expect(detectMobile(MAC)).toBe(false);
  });

  it('does not call a narrow desktop window mobile', () => {
    asDevice({ width: 700, touchPoints: 0 });
    expect(detectMobile(WINDOWS)).toBe(false);
  });
});

describe('detectIPad', () => {
  it('recognises an explicit iPad', () => {
    asDevice({ touchPoints: 5 });
    expect(detectIPad(IPAD)).toBe(true);
  });

  it('recognises desktop mode by touch points, which is what survives there', () => {
    asDevice({ touchPoints: 5 });
    expect(detectIPad(MAC)).toBe(true);
  });

  it('leaves a real Mac alone: no Mac reports touch points', () => {
    asDevice({ touchPoints: 0 });
    expect(detectIPad(MAC)).toBe(false);
  });

  it('does not claim a touchscreen Windows laptop', () => {
    asDevice({ touchPoints: 10, touchEvent: true });
    expect(detectIPad(WINDOWS)).toBe(false);
  });
});

describe('detectMobileUserAgent', () => {
  it('reads the platform out of the user agent, nothing else', () => {
    expect(detectMobileUserAgent(IPHONE)).toBe(true);
    expect(detectMobileUserAgent(ANDROID)).toBe(true);
    expect(detectMobileUserAgent(WINDOWS)).toBe(false);
    // A Mac user agent is a Mac here; the iPad-in-desktop-mode case needs the
    // touch-point signal that only detectIPad looks at.
    expect(detectMobileUserAgent(MAC)).toBe(false);
  });
});
