/**
 * Which layout a viewport gets: the sidebar-and-preview desktop one, or the
 * single-column mobile one.
 *
 * This is a question about the FORM FACTOR, not about the device's identity,
 * so it turns on the viewport and the platform rather than on what the device
 * can do. `detectors.ts` answers the other question — what the device is —
 * for the PDF delivery decisions that genuinely need it.
 *
 * Deliberately NOT decided from touch. A touch panel is a capability, not a
 * form factor: Windows laptops with one report touch, and at the 150–200%
 * display scaling their high-DPI panels ship with, a 1920- or 2560-wide screen
 * reports about 1280 CSS px. Testing touch against a width threshold therefore
 * put every touchscreen laptop on the phone layout with its sidebar hidden.
 *
 * The pointer media features (`pointer: coarse`, `any-pointer: fine`) look
 * like the principled answer and are not, on the platform that matters: both
 * misreport on Windows touch laptops. Chromium 40277167 has `any-pointer:
 * fine` failing to match where a mouse is present, and Mozilla 1638556 has
 * `pointer: coarse` reported as primary on a laptop with a trackpad. A rule
 * resting on them would keep the bug on some of the machines it is meant to
 * fix, so the platform is asked directly instead.
 */

import { detectIPad, detectMobileUserAgent } from './detectors';

/** Below this a viewport has no room for the sidebar, whatever is driving it. */
const PHONE_WIDTH = 768;

/** A tablet held in landscape still gets the mobile layout up to here. */
const TABLET_WIDTH = 1366;

export interface LayoutEnvironment {
  /** `window.innerWidth`, in CSS pixels. */
  width: number;
  /** An iPad, including one reporting itself as a Mac. */
  isIPad: boolean;
  /** A phone or tablet operating system — not merely a device that has touch. */
  isMobilePlatform: boolean;
}

export function prefersMobileLayout({ width, isIPad, isMobilePlatform }: LayoutEnvironment): boolean {
  if (width < PHONE_WIDTH) return true;
  // An iPad takes the mobile layout at any size: the embedded PDF preview
  // does not work there, which is why the exception exists at all.
  if (isIPad) return true;
  return isMobilePlatform && width < TABLET_WIDTH;
}

/** Read the current window's layout environment. */
export function readLayoutEnvironment(): LayoutEnvironment {
  const userAgentData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return {
    width: window.innerWidth,
    isIPad: detectIPad(navigator.userAgent),
    // Chromium states it outright, but only for phones — it reports a tablet
    // as not-mobile — so the user agent string still has to be consulted for
    // the tablets it disowns.
    isMobilePlatform: userAgentData?.mobile === true || detectMobileUserAgent(navigator.userAgent),
  };
}
