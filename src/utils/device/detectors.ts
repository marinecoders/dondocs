/**
 * Device Detection Functions
 * ==========================
 * 
 * These functions detect device/browser characteristics from the user agent.
 * 
 * IMPORTANT NOTES:
 * ----------------
 * 
 * 1. User agent detection is inherently fragile - browsers can (and do) lie.
 *    Always have fallback behavior.
 * 
 * 2. iOS browsers are all WebKit under the hood (Apple policy). Chrome, Firefox,
 *    Edge on iOS are just WebKit with different UIs. This means they share many
 *    of the same bugs/limitations.
 * 
 * 3. iPads in "desktop mode" report as Macintosh, so we check for touch support
 *    to detect them.
 * 
 * 4. In-app browsers (Facebook, Instagram, etc.) are WKWebView instances and
 *    have severe limitations - especially with blob URLs.
 */

import { useState, useEffect } from 'react';
import type { DeviceInfo } from './types';

/**
 * Detect if running on iPad
 * 
 * QUIRK: iPadOS 13+ in desktop mode reports as Macintosh, not iPad.
 * We detect this by checking for Macintosh + touch support.
 */
export function detectIPad(ua: string): boolean {
  // Explicit iPad in user agent
  if (/iPad/i.test(ua)) return true;
  
  // iPadOS desktop mode: Reports as Macintosh but has touch
  if (/Macintosh/i.test(ua) && typeof window !== 'undefined' && 'ontouchstart' in window) {
    return true;
  }
  
  return false;
}

/**
 * Detect if running on iPhone or iPod (iOS phones, not tablets)
 */
export function detectIPhone(ua: string): boolean {
  return /iPhone|iPod/i.test(ua);
}

/**
 * Detect if running on any iOS device
 */
export function detectIOS(ua: string): boolean {
  return detectIPhone(ua) || detectIPad(ua);
}

/**
 * Detect if running on Android
 */
export function detectAndroid(ua: string): boolean {
  return /Android/i.test(ua);
}

/**
 * Detect if running on any mobile device
 * 
 * Includes phones AND tablets. For phone-only detection, use isIPhone && !isIPad
 */
export function detectMobile(ua: string): boolean {
  // Check user agent patterns
  const uaIsMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  
  // Also check touch support + small screen as fallback
  if (typeof window !== 'undefined') {
    const hasTouch = 'ontouchstart' in window;
    const isSmallScreen = window.innerWidth < 1024;
    if (hasTouch && isSmallScreen) return true;
  }
  
  return uaIsMobile;
}

/**
 * Detect Chrome on iOS
 * 
 * IMPORTANT: Chrome iOS uses "CriOS" in user agent, NOT "Chrome".
 * Chrome iOS is WebKit-based and has different bugs than desktop Chrome.
 */
export function detectChromeIOS(ua: string): boolean {
  return /CriOS/i.test(ua);
}

/**
 * Detect Chrome browser (any platform)
 */
export function detectChrome(ua: string): boolean {
  // Chrome uses "Chrome" on desktop/Android, "CriOS" on iOS
  // Exclude Edge which also contains "Chrome"
  return (/Chrome|CriOS/i.test(ua)) && !/Edg/i.test(ua);
}

/**
 * Detect Firefox on iOS
 * 
 * Firefox iOS uses "FxiOS" in user agent.
 * Like Chrome iOS, it's WebKit-based with similar limitations.
 */
export function detectFirefoxIOS(ua: string): boolean {
  return /FxiOS/i.test(ua);
}

/**
 * Detect Firefox browser (any platform)
 */
export function detectFirefox(ua: string): boolean {
  return /Firefox|FxiOS/i.test(ua);
}

/**
 * Detect Edge browser
 */
export function detectEdge(ua: string): boolean {
  return /Edg/i.test(ua);
}

/**
 * Detect Safari browser
 * 
 * NOTE: Many browsers include "Safari" in their user agent for compatibility.
 * We exclude Chrome, Firefox, and Edge to get "real" Safari.
 * 
 * HOWEVER: In-app browsers also pass this test, so use isRealSafari for
 * the actual Safari app.
 */
export function detectSafari(ua: string): boolean {
  const hasSafari = /Safari/i.test(ua);
  const isChrome = detectChrome(ua);
  const isFirefox = detectFirefox(ua);
  const isEdge = detectEdge(ua);
  
  return hasSafari && !isChrome && !isFirefox && !isEdge;
}

// === In-App Browser Detection ===
// These are WKWebView instances embedded in apps
// They have SEVERE limitations with blob URLs and downloads

/**
 * Detect Google Search App's in-app browser
 * 
 * User agent contains "GSA/" (Google Search App)
 */
export function detectGoogleApp(ua: string): boolean {
  return /GSA\//i.test(ua);
}

/**
 * Detect Facebook app's in-app browser
 * 
 * User agent contains "FBAN" or "FBAV" (Facebook App)
 */
export function detectFacebookApp(ua: string): boolean {
  return /FBAN|FBAV/i.test(ua);
}

/**
 * Detect Instagram app's in-app browser
 */
export function detectInstagramApp(ua: string): boolean {
  return /Instagram/i.test(ua);
}

/**
 * Detect Twitter/X app's in-app browser
 */
export function detectTwitterApp(ua: string): boolean {
  return /Twitter/i.test(ua);
}

/**
 * Detect LinkedIn app's in-app browser
 */
export function detectLinkedInApp(ua: string): boolean {
  return /LinkedInApp/i.test(ua);
}

/**
 * Detect any in-app browser
 * 
 * CRITICAL: In-app browsers on iOS use WKWebView which has broken
 * blob URL support. This is a known WebKit bug that has existed since 2020.
 * See: https://bugs.webkit.org/show_bug.cgi?id=216918
 * 
 * When isInAppBrowser is true, you CANNOT reliably:
 * - Download files via blob URLs
 * - Open blob URLs in new windows
 * - Use the download attribute on anchors
 * 
 * The only solution is to tell users to open in Safari.
 */
export function detectInAppBrowser(ua: string): boolean {
  return (
    detectGoogleApp(ua) ||
    detectFacebookApp(ua) ||
    detectInstagramApp(ua) ||
    detectTwitterApp(ua) ||
    detectLinkedInApp(ua)
  );
}

/**
 * Get comprehensive device information
 * 
 * This is the main function to use for device detection.
 * Call this once and pass the result around rather than
 * calling individual detection functions multiple times.
 */
export function getDeviceInfo(): DeviceInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  
  const isIPad = detectIPad(ua);
  const isIPhone = detectIPhone(ua);
  const isIOS = isIPhone || isIPad;
  const isAndroid = detectAndroid(ua);
  const isMobile = detectMobile(ua);
  const isDesktop = !isMobile;
  
  const isChromeIOS = detectChromeIOS(ua);
  const isChrome = detectChrome(ua);
  const isFirefoxIOS = detectFirefoxIOS(ua);
  const isFirefox = detectFirefox(ua);
  const isEdge = detectEdge(ua);
  const isSafari = detectSafari(ua);
  
  const isGoogleApp = detectGoogleApp(ua);
  const isFacebookApp = detectFacebookApp(ua);
  const isInstagramApp = detectInstagramApp(ua);
  const isTwitterApp = detectTwitterApp(ua);
  const isLinkedInApp = detectLinkedInApp(ua);
  const isInAppBrowser = detectInAppBrowser(ua);
  
  // "Real" Safari = Safari browser app, not an in-app browser
  const isRealSafari = isSafari && !isInAppBrowser;
  
  return {
    isIOS,
    isIPad,
    isIPhone,
    isAndroid,
    isMobile,
    isDesktop,
    isSafari,
    isRealSafari,
    isChromeIOS,
    isChrome,
    isFirefoxIOS,
    isFirefox,
    isEdge,
    isGoogleApp,
    isFacebookApp,
    isInstagramApp,
    isTwitterApp,
    isLinkedInApp,
    isInAppBrowser,
    userAgent: ua,
  };
}

/**
 * React hook for device detection
 * 
 * Use this in components instead of calling getDeviceInfo directly,
 * as it properly handles SSR and hydration.
 */
export function useDeviceInfo(): DeviceInfo {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>(() => ({
    isIOS: false,
    isIPad: false,
    isIPhone: false,
    isAndroid: false,
    isMobile: false,
    isDesktop: true,
    isSafari: false,
    isRealSafari: false,
    isChromeIOS: false,
    isChrome: false,
    isFirefoxIOS: false,
    isFirefox: false,
    isEdge: false,
    isGoogleApp: false,
    isFacebookApp: false,
    isInstagramApp: false,
    isTwitterApp: false,
    isLinkedInApp: false,
    isInAppBrowser: false,
    userAgent: '',
  }));
  
  // Read live device info on mount. Initial state above is a static
  // fallback (false flags for SSR / pre-hydration); the real read uses
  // `navigator.userAgent` which is only available in the browser.
  // Legitimate "synchronize React state with external system" pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeviceInfo(getDeviceInfo());
  }, []);
  
  return deviceInfo;
}

/**
 * Log device info for debugging
 * 
 * Call this during development to see what's being detected.
 */
export function logDeviceInfo(prefix: string = '[DeviceInfo]'): void {
  const info = getDeviceInfo();
  console.log(`${prefix} UA:`, info.userAgent);
  console.log(`${prefix} Platform:`, {
    isIOS: info.isIOS,
    isIPad: info.isIPad,
    isIPhone: info.isIPhone,
    isAndroid: info.isAndroid,
    isMobile: info.isMobile,
    isDesktop: info.isDesktop,
  });
  console.log(`${prefix} Browser:`, {
    isSafari: info.isSafari,
    isRealSafari: info.isRealSafari,
    isChrome: info.isChrome,
    isChromeIOS: info.isChromeIOS,
    isFirefox: info.isFirefox,
    isFirefoxIOS: info.isFirefoxIOS,
    isEdge: info.isEdge,
  });
  console.log(`${prefix} In-App:`, {
    isInAppBrowser: info.isInAppBrowser,
    isGoogleApp: info.isGoogleApp,
    isFacebookApp: info.isFacebookApp,
    isInstagramApp: info.isInstagramApp,
    isTwitterApp: info.isTwitterApp,
    isLinkedInApp: info.isLinkedInApp,
  });
}
