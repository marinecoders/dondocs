import { describe, it, expect } from 'vitest';
import { prefersMobileLayout } from '@/utils/device/layout';

// A touch panel is not a form factor. The rule this replaces tested touch
// against a width threshold, and a Windows laptop with a touchscreen reports
// both: at the 150-200% display scaling its high-DPI panel ships with, a
// 1920- or 2560-wide screen is about 1280 CSS px. Every one of them was
// served the phone layout, which hides the sidebar outright.
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
