/**
 * Which layout a viewport gets: the sidebar-and-preview desktop one, or the
 * single-column mobile one.
 *
 * This is a question about the FORM FACTOR, not about the device's identity,
 * so it is decided from the viewport and the pointers available rather than
 * from the user agent. `detectors.ts` answers the other question — what the
 * device is — for the PDF delivery decisions that genuinely need it.
 */

/** Below this a viewport has no room for the sidebar, whatever is driving it. */
const PHONE_WIDTH = 768;

/** A tablet held in landscape still gets the mobile layout up to here. */
const TABLET_WIDTH = 1366;

export interface LayoutEnvironment {
  /** `window.innerWidth`, in CSS pixels. */
  width: number;
  /** An iPad, including one reporting itself as a Mac. */
  isIPad: boolean;
  /**
   * A finger is the primary input AND no fine pointer exists at all.
   *
   * The second half is what a touchscreen laptop fails, and it is the whole
   * point: a touch panel is not a form factor. Windows laptops with one
   * report touch, and at the 150–200% display scaling their high-DPI panels
   * ship with, a 1920- or 2560-wide screen reports about 1280 CSS px. Testing
   * touch against a width threshold therefore put every touchscreen laptop on
   * the phone layout with its sidebar hidden. A laptop has a trackpad; a
   * tablet does not.
   */
  touchPrimary: boolean;
}

export function prefersMobileLayout({ width, isIPad, touchPrimary }: LayoutEnvironment): boolean {
  if (width < PHONE_WIDTH) return true;
  // An iPad takes the mobile layout at any size: the embedded PDF preview
  // does not work there, which is why the exception exists at all.
  if (isIPad) return true;
  return touchPrimary && width < TABLET_WIDTH;
}

/** Read the current window's layout environment. */
export function readLayoutEnvironment(): LayoutEnvironment {
  const matches = (query: string) =>
    typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return {
    width: window.innerWidth,
    // iPadOS reports itself as a Mac; no Mac has a touchscreen, so touch plus
    // a Mac user agent is an iPad.
    isIPad: /iPad/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && hasTouch),
    touchPrimary: matches('(pointer: coarse)') && !matches('(any-pointer: fine)'),
  };
}
