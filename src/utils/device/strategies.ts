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
 * All platforms render through the shared in-app viewer
 * (src/components/pdf/PdfViewer.tsx) — page virtualization plus a capped
 * devicePixelRatio keep canvas memory inside iOS budgets, so no per-device
 * viewer split remains. Only DOWNLOAD strategy varies by device.
 */

import type { DeviceInfo, DeviceStrategy, PdfDownloadStrategy } from './types';
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
 * Get complete strategy recommendations with reasoning. Preview no longer
 * varies by device (one in-app viewer everywhere); only downloads do.
 */
export function getDeviceStrategy(device?: DeviceInfo): DeviceStrategy {
  const info = device || getDeviceInfo();
  const download = getPdfDownloadStrategy(info);

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
    reasoning = 'Chrome iOS detected. Blob URLs broken, using FileReader + data URL + window.open.';
  } else if (info.isIOS && info.isFirefoxIOS) {
    reasoning = 'Firefox iOS detected. Same WebKit limitations as Chrome iOS. Using data URL approach.';
  } else if (info.isIOS && info.isRealSafari) {
    reasoning = 'iOS Safari detected. Standard blob download with octet-stream MIME type.';
  } else if (info.isAndroid) {
    reasoning = 'Android detected. Data URL download is more reliable than blob URLs.';
  } else {
    reasoning = 'Desktop browser detected. Standard blob URL for download.';
  }

  return { download, reasoning };
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
