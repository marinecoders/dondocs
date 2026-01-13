/**
 * Platform-Specific Strategies
 * ============================
 * 
 * This module recommends strategies for PDF downloading and preview
 * based on device detection.
 * 
 * WHY DIFFERENT STRATEGIES:
 * -------------------------
 * 
 * PDF DOWNLOAD:
 * 
 * 1. Desktop browsers: Standard blob URL + anchor click works perfectly.
 * 
 * 2. iOS Safari: Blob URL + anchor with download attribute works, but
 *    MUST use application/octet-stream MIME type to force download
 *    instead of opening in browser.
 * 
 * 3. iOS Chrome (CriOS): Blob URLs are BROKEN (WebKit bug #216918).
 *    Must convert to data URL via FileReader, then either:
 *    - window.open() the data URL, OR
 *    - Set location.href to data URL
 *    User sees PDF and can share/save from there.
 * 
 * 4. iOS In-App Browsers (Google App, Facebook, etc.): Everything is broken.
 *    WKWebView doesn't support blob URL downloads AT ALL.
 *    Only option is to show instructions telling user to open in Safari.
 * 
 * 5. Android Chrome: Blob URLs sometimes fail silently. Data URL approach
 *    is more reliable.
 * 
 * PDF PREVIEW:
 * 
 * 1. Desktop: Native iframe works perfectly - browsers have built-in
 *    PDF viewers.
 * 
 * 2. iPad: Native iframe also works great - Safari has excellent PDF
 *    viewing with zoom, scroll, etc.
 * 
 * 3. iPhone/Android phones: Screen is small, native viewer is awkward.
 *    Use react-pdf-viewer for custom UI with zoom controls.
 */

import type { DeviceInfo, DeviceStrategy, PdfDownloadStrategy, PdfPreviewStrategy } from './types';
import { getDeviceInfo } from './detectors';

/**
 * Get the recommended PDF download strategy for the current device
 */
export function getPdfDownloadStrategy(device?: DeviceInfo): PdfDownloadStrategy {
  const info = device || getDeviceInfo();
  
  // iOS In-App Browsers: Nothing works, show instructions
  if (info.isIOS && info.isInAppBrowser) {
    return 'show-instructions';
  }
  
  // iOS Chrome: Use data URL + window.open
  if (info.isIOS && info.isChromeIOS) {
    return 'data-url-window';
  }
  
  // iOS Firefox: Same issue as Chrome
  if (info.isIOS && info.isFirefoxIOS) {
    return 'data-url-window';
  }
  
  // iOS Safari: Blob URL with octet-stream works
  if (info.isIOS && info.isRealSafari) {
    return 'blob-anchor';
  }
  
  // iOS other (Edge, etc.): Try data URL approach
  if (info.isIOS) {
    return 'data-url-window';
  }
  
  // Android: Data URL is more reliable than blob URL
  if (info.isAndroid) {
    return 'data-url-anchor';
  }
  
  // Desktop: Standard blob URL works
  return 'blob-anchor';
}

/**
 * Get the recommended PDF preview strategy for the current device
 * 
 * NOTE: We use react-pdf-viewer for ALL iOS devices (iPhone AND iPad) because:
 * - react-pdf crashes on iOS due to canvas memory limits (384MB)
 * - iframe shows black screen on iPad (tested and failed)
 * - react-pdf-viewer works reliably on all iOS devices
 */
export function getPdfPreviewStrategy(device?: DeviceInfo): PdfPreviewStrategy {
  const info = device || getDeviceInfo();
  
  // iOS (iPhone AND iPad): Use react-pdf-viewer
  // This is the ONLY viewer that works reliably on iOS
  if (info.isIOS) {
    return 'react-pdf-viewer';
  }
  
  // Desktop: Use native iframe, browser has built-in PDF viewer
  if (info.isDesktop) {
    return 'iframe';
  }
  
  // Android phones/tablets: Use react-pdf-viewer for custom UI
  return 'react-pdf-viewer';
}

/**
 * Get complete strategy recommendations with reasoning
 */
export function getDeviceStrategy(device?: DeviceInfo): DeviceStrategy {
  const info = device || getDeviceInfo();
  const download = getPdfDownloadStrategy(info);
  const preview = getPdfPreviewStrategy(info);
  
  // Generate human-readable reasoning
  let reasoning: string;
  
  if (info.isIOS && info.isInAppBrowser) {
    const appName = info.isGoogleApp ? 'Google App' :
                    info.isFacebookApp ? 'Facebook' :
                    info.isInstagramApp ? 'Instagram' :
                    info.isTwitterApp ? 'Twitter' :
                    info.isLinkedInApp ? 'LinkedIn' : 'in-app browser';
    reasoning = `${appName} in-app browser detected. WKWebView doesn't support blob URL downloads (WebKit bug #216918). User must open in Safari.`;
  } else if (info.isIOS && info.isChromeIOS) {
    reasoning = 'Chrome iOS detected. Blob URLs broken, using FileReader + data URL + window.open. Preview uses react-pdf-viewer for phone-optimized UI.';
  } else if (info.isIOS && info.isFirefoxIOS) {
    reasoning = 'Firefox iOS detected. Same WebKit limitations as Chrome iOS. Using data URL approach.';
  } else if (info.isIOS && info.isRealSafari && info.isIPad) {
    reasoning = 'iPad Safari detected. Native iframe for preview (excellent built-in PDF viewer). Standard blob download with octet-stream MIME type.';
  } else if (info.isIOS && info.isRealSafari) {
    reasoning = 'iPhone Safari detected. react-pdf-viewer for phone-optimized preview. Standard blob download with octet-stream MIME type.';
  } else if (info.isAndroid) {
    reasoning = 'Android detected. Data URL download is more reliable than blob URLs. react-pdf-viewer for phone-optimized preview.';
  } else {
    reasoning = 'Desktop browser detected. Native iframe for preview, standard blob URL for download.';
  }
  
  return { download, preview, reasoning };
}

/**
 * Check if downloads are fully supported on this device
 * 
 * Returns false for in-app browsers where downloads are broken.
 */
export function isDownloadSupported(device?: DeviceInfo): boolean {
  const info = device || getDeviceInfo();
  return !info.isInAppBrowser;
}

/**
 * Get user-facing message for unsupported download scenarios
 */
export function getDownloadUnsupportedMessage(device?: DeviceInfo): string {
  const info = device || getDeviceInfo();
  
  if (!info.isInAppBrowser) {
    return ''; // Downloads are supported
  }
  
  const appName = info.isGoogleApp ? 'the Google app' :
                  info.isFacebookApp ? 'Facebook' :
                  info.isInstagramApp ? 'Instagram' :
                  info.isTwitterApp ? 'Twitter' :
                  info.isLinkedInApp ? 'LinkedIn' : 'this app';
  
  return `PDF downloads don't work in ${appName}'s browser.\n\nCompatible browsers:\n• Safari\n• Chrome\n• Firefox\n• Edge\n\nTap ⋮ or the share button and select "Open in Safari" to download.`;
}
