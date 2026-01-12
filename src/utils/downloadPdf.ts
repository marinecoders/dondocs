/**
 * Cross-platform PDF Download Utility
 * ====================================
 * 
 * Handles PDF downloading across all platforms with appropriate fallbacks.
 * 
 * See /utils/device/index.ts for detailed documentation on platform quirks.
 */

import { 
  getDeviceInfo, 
  getPdfDownloadStrategy, 
  getDownloadUnsupportedMessage,
  type DeviceInfo 
} from './device';

/**
 * Download PDF using FileReader -> Data URL -> anchor click
 * 
 * WHY: More reliable on Android where blob URLs can fail silently.
 * The data URL is embedded in the anchor href, triggering browser's
 * native download behavior.
 */
function downloadViaDataUrl(blob: Blob, filename: string): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function(event) {
      const dataUrl = event.target?.result as string;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      resolve(true);
    };
    reader.onerror = function() {
      console.error('[downloadPdf] FileReader failed');
      resolve(false);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Open PDF via FileReader -> Data URL -> window.open
 * 
 * WHY: Chrome iOS doesn't support blob URL downloads, but CAN open
 * data URLs. User sees the PDF and can use share button to save.
 * 
 * Falls back to location.href if popup is blocked.
 */
function openViaDataUrlInNewWindow(blob: Blob, filename: string): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = function() {
      const dataUrl = reader.result as string;
      console.log('[downloadPdf] Data URL created, length:', dataUrl.length);
      
      // Try method 1: window.open
      const newWindow = window.open(dataUrl, '_blank');
      if (newWindow) {
        console.log('[downloadPdf] window.open succeeded');
        resolve(true);
        return;
      }
      
      console.log('[downloadPdf] window.open failed/blocked, trying anchor with data URL');
      
      // Try method 2: anchor tag with data URL
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Try method 3: location.href as last resort
      setTimeout(() => {
        console.log('[downloadPdf] Trying location.href as final fallback');
        window.location.href = dataUrl;
      }, 500);
      
      resolve(true);
    };
    reader.onerror = function() {
      console.error('[downloadPdf] FileReader failed');
      resolve(false);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Download PDF via blob URL + anchor click
 * 
 * WHY: Standard approach that works on desktop and iOS Safari.
 * Uses application/octet-stream to force download instead of preview.
 */
function downloadViaBlobAnchor(blob: Blob, filename: string): void {
  // Use octet-stream to force download behavior on iOS Safari
  const downloadBlob = new Blob([blob], { type: 'application/octet-stream' });
  const downloadUrl = URL.createObjectURL(downloadBlob);
  
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // Clean up blob URL after delay (give browser time to start download)
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
}

/**
 * Downloads a PDF blob with platform-specific handling
 * 
 * @param blob - The PDF blob to download
 * @param filename - The filename for the download (default: 'correspondence.pdf')
 * @param preOpenedWindow - Optional pre-opened window (legacy, no longer used)
 */
export async function downloadPdfBlob(
  blob: Blob,
  filename: string = 'correspondence.pdf',
  preOpenedWindow?: Window | null
): Promise<boolean> {
  // Close any pre-opened window (legacy support)
  if (preOpenedWindow) preOpenedWindow.close();
  
  const device = getDeviceInfo();
  const strategy = getPdfDownloadStrategy(device);
  
  // Log for debugging
  console.log('[downloadPdf] UA:', device.userAgent);
  console.log('[downloadPdf] Device:', {
    isIOS: device.isIOS,
    isIPad: device.isIPad,
    isIPhone: device.isIPhone,
    isAndroid: device.isAndroid,
    isSafari: device.isSafari,
    isRealSafari: device.isRealSafari,
    isChrome: device.isChrome,
    isChromeIOS: device.isChromeIOS,
    isInAppBrowser: device.isInAppBrowser,
    isGoogleApp: device.isGoogleApp,
  });
  console.log('[downloadPdf] Strategy:', strategy);
  
  switch (strategy) {
    case 'show-instructions': {
      // In-app browsers can't download - show user instructions
      console.log('[downloadPdf] In-app browser detected - showing instructions');
      const message = getDownloadUnsupportedMessage(device);
      alert(message);
      
      // Still try blob URL as last-ditch effort (probably won't work)
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const newWindow = window.open(pdfUrl, '_blank');
      if (!newWindow) {
        const a = document.createElement('a');
        a.href = pdfUrl;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 30000);
      return true;
    }
    
    case 'data-url-window': {
      // Chrome iOS, Firefox iOS: Use FileReader + data URL + window.open
      console.log('[downloadPdf] Using data URL + window.open approach');
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const success = await openViaDataUrlInNewWindow(pdfBlob, filename);
      
      if (!success) {
        // Fallback to blob anchor (probably won't work but try anyway)
        console.log('[downloadPdf] Data URL failed, trying blob anchor fallback');
        downloadViaBlobAnchor(blob, filename);
      }
      return true;
    }
    
    case 'data-url-anchor': {
      // Android: Use FileReader + data URL + anchor click
      console.log('[downloadPdf] Using data URL + anchor approach');
      const downloadBlob = new Blob([blob], { type: 'application/octet-stream' });
      const success = await downloadViaDataUrl(downloadBlob, filename);
      
      if (!success) {
        // Fallback to blob anchor
        console.log('[downloadPdf] Data URL failed, trying blob anchor fallback');
        downloadViaBlobAnchor(blob, filename);
      }
      return true;
    }
    
    case 'blob-anchor':
    default: {
      // Desktop, iOS Safari: Standard blob URL + anchor
      console.log('[downloadPdf] Using blob URL + anchor approach');
      downloadViaBlobAnchor(blob, filename);
      return true;
    }
  }
}

/**
 * Pre-opens a window for iOS browsers to avoid popup blocker
 * 
 * DEPRECATED: No longer needed - all strategies now work without pre-opening.
 * Kept for backwards compatibility.
 */
export function preOpenWindowForIOS(): Window | null {
  return null;
}

// Re-export device utilities for convenience
export { getDeviceInfo, type DeviceInfo };
