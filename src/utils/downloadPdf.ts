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
import { showAppAlert } from '@/stores/alertStore';

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
 * Show a PDF in a prepared tab on iOS Chrome/Firefox. Top-level data URL
 * navigation is blocked by modern browsers; embedding it in a document keeps
 * the PDF preview available and gives the user an explicit file download link.
 * If popups are blocked, fall back to a download without navigating the editor.
 */
function openViaDataUrlInNewWindow(blob: Blob, filename: string, prepared?: Window | null): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function() {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        prepared?.close();
        resolve(false);
        return;
      }
      try {
        const target = prepared && !prepared.closed ? prepared : window.open('', '_blank');
        if (!target) {
          void downloadViaDataUrl(new Blob([blob], { type: 'application/octet-stream' }), filename).then(resolve);
          return;
        }
        target.opener = null;
        const doc = target.document;
        doc.title = filename;
        doc.body.style.margin = '0';
        const save = doc.createElement('a');
        save.textContent = 'Download PDF';
        save.download = filename;
        save.href = dataUrl.replace('data:application/pdf;', 'data:application/octet-stream;');
        save.style.cssText = 'display:block;padding:14px;font:16px system-ui';
        const preview = doc.createElement('iframe');
        preview.title = filename;
        preview.src = dataUrl;
        preview.style.cssText = 'display:block;width:100%;height:calc(100vh - 48px);border:0';
        doc.body.replaceChildren(save, preview);
        resolve(true);
      } catch {
        // The prepared tab may have navigated to another origin meanwhile.
        resolve(false);
      }
    };
    reader.onerror = function() {
      prepared?.close();
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
 * @param preOpenedWindow - iOS PDF tab opened synchronously from the user gesture
 */
export async function downloadPdfBlob(
  blob: Blob,
  filename: string = 'correspondence.pdf',
  preOpenedWindow?: Window | null
): Promise<boolean> {
  const device = getDeviceInfo();
  const strategy = getPdfDownloadStrategy(device);
  if (strategy !== 'data-url-window') preOpenedWindow?.close();
  
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
      showAppAlert({ title: 'Downloads need a real browser', message });
      
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
      const success = await openViaDataUrlInNewWindow(pdfBlob, filename, preOpenedWindow);
      
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

/** Open the iOS PDF tab during the click, before compilation uses activation. */
export function preOpenWindowForIOS(): Window | null {
  if (getPdfDownloadStrategy() !== 'data-url-window') return null;
  try {
    const target = window.open('', '_blank');
    if (target) {
      target.opener = null;
      target.document.title = 'Preparing PDF';
      target.document.body.textContent = 'Preparing your PDF…';
    }
    return target;
  } catch {
    return null;
  }
}

// Re-export device utilities for convenience
export { getDeviceInfo, type DeviceInfo };
