/**
 * Cross-platform PDF download utility
 * Handles iOS Safari, iOS Chrome, Android Chrome, and desktop browsers
 *
 * References:
 * - https://github.com/eligrey/FileSaver.js/pull/612 (Chrome iOS FileReader fix)
 * - https://github.com/eligrey/FileSaver.js/issues/686 (Chrome iOS blob issues)
 * - https://copyprogramming.com/howto/how-to-open-blob-url-on-chrome-ios
 */

interface DeviceInfo {
  isIOS: boolean;
  isIPad: boolean;
  isSafari: boolean;
  isAndroid: boolean;
  isChrome: boolean;
  isChromeIOS: boolean;
  isFirefoxIOS: boolean;
}

function getDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent;
  const isIPad = /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && 'ontouchstart' in window);
  const isIOS = /iPhone|iPod/i.test(ua) || isIPad;
  const isAndroid = /Android/i.test(ua);

  // Chrome on iOS uses "CriOS", Chrome desktop/Android uses "Chrome"
  // Edge uses "Edg", Firefox uses "FxiOS" on iOS
  const isChromeIOS = /CriOS/i.test(ua);
  const isChrome = /Chrome|CriOS/i.test(ua) && !/Edg/i.test(ua);
  const isFirefoxIOS = /FxiOS/i.test(ua);
  const isFirefox = /Firefox|FxiOS/i.test(ua);
  const isEdge = /Edg/i.test(ua);

  // Safari is true only if it says Safari AND is not Chrome/Firefox/Edge
  const isSafari = /Safari/i.test(ua) && !isChrome && !isFirefox && !isEdge;

  console.log('[downloadPdf] UA:', ua);
  console.log('[downloadPdf] isIOS:', isIOS, 'isAndroid:', isAndroid, 'isSafari:', isSafari, 'isChrome:', isChrome, 'isChromeIOS:', isChromeIOS);

  return { isIOS, isIPad, isSafari, isAndroid, isChrome, isChromeIOS, isFirefoxIOS };
}

/**
 * Download using FileReader -> Data URL approach
 * More reliable on Chrome Android where blob URLs can fail
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
 * Chrome iOS specific: open PDF in new window using FileReader -> Data URL
 * Chrome iOS doesn't support blob URL downloads, but can open data URLs
 * User will see the PDF and can use share button to save
 */
function openViaDataUrlInNewWindow(blob: Blob, filename: string): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = function() {
      const dataUrl = reader.result as string;
      // Open the data URL in a new window - Chrome iOS will show the PDF
      // User can then use the share button to save
      const newWindow = window.open(dataUrl, '_blank');
      if (newWindow) {
        resolve(true);
      } else {
        // Popup blocked - try location.href as fallback
        console.log('[downloadPdf] Popup blocked, trying location.href');
        window.location.href = dataUrl;
        resolve(true);
      }
    };
    reader.onerror = function() {
      console.error('[downloadPdf] FileReader failed for Chrome iOS');
      resolve(false);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Downloads a PDF blob with platform-specific handling
 * For iOS Safari: uses anchor download with octet-stream
 * For iOS Chrome: uses FileReader -> Data URL -> window.open (blob URLs don't work)
 * For Android Chrome: uses FileReader -> Data URL (more reliable)
 * For Desktop: triggers standard download
 *
 * @param blob - The PDF blob to download
 * @param filename - The filename for the download (default: 'correspondence.pdf')
 * @param preOpenedWindow - Optional pre-opened window (for Safari popup blocker workaround)
 */
export async function downloadPdfBlob(
  blob: Blob,
  filename: string = 'correspondence.pdf',
  preOpenedWindow?: Window | null
): Promise<boolean> {
  const { isIOS, isSafari, isAndroid, isChrome, isChromeIOS, isFirefoxIOS } = getDeviceInfo();

  // iOS Chrome: Use FileReader -> Data URL -> window.open
  // Chrome iOS does NOT support blob URL downloads - this is a known long-standing issue
  // The download attribute on anchor tags doesn't work with blob URLs in Chrome iOS
  // We must convert to a data URL and open in a new window
  if (isIOS && isChromeIOS) {
    console.log('[downloadPdf] iOS Chrome detected - using FileReader + window.open approach');
    if (preOpenedWindow) preOpenedWindow.close();

    // Keep as PDF type so Chrome iOS renders it properly
    const pdfBlob = new Blob([blob], { type: 'application/pdf' });
    const success = await openViaDataUrlInNewWindow(pdfBlob, filename);
    
    if (!success) {
      // Ultimate fallback: try the anchor method anyway
      console.log('[downloadPdf] Data URL window.open failed, trying anchor fallback');
      const downloadBlob = new Blob([blob], { type: 'application/octet-stream' });
      const downloadUrl = URL.createObjectURL(downloadBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
    }
    return true;
  }

  // iOS Firefox: Similar issues to Chrome iOS - use data URL approach
  if (isIOS && isFirefoxIOS) {
    console.log('[downloadPdf] iOS Firefox detected - using FileReader + window.open approach');
    if (preOpenedWindow) preOpenedWindow.close();

    const pdfBlob = new Blob([blob], { type: 'application/pdf' });
    await openViaDataUrlInNewWindow(pdfBlob, filename);
    return true;
  }

  // Android Chrome: use FileReader -> Data URL approach (blob URLs can fail on Android)
  // This triggers Chrome's native "Download" or "Save to Drive" UI
  if (isAndroid && isChrome) {
    console.log('[downloadPdf] Android Chrome detected - using Data URL approach');
    if (preOpenedWindow) preOpenedWindow.close();

    // Use octet-stream to force download behavior
    const downloadBlob = new Blob([blob], { type: 'application/octet-stream' });
    const success = await downloadViaDataUrl(downloadBlob, filename);
    if (success) return true;

    // Fallback to standard blob URL if data URL fails
    console.log('[downloadPdf] Data URL failed, falling back to blob URL');
    const url = URL.createObjectURL(downloadBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }

  // iOS Safari: use anchor download with octet-stream
  if (isIOS && isSafari) {
    console.log('[downloadPdf] iOS Safari detected - using octet-stream anchor download');
    if (preOpenedWindow) preOpenedWindow.close();

    // Re-create blob with octet-stream MIME type to force download
    const downloadBlob = new Blob([blob], { type: 'application/octet-stream' });
    const downloadUrl = URL.createObjectURL(downloadBlob);

    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    a.click();

    setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
    return true;
  }

  // iOS other browsers (Edge, etc.): try data URL approach
  if (isIOS && !isSafari) {
    console.log('[downloadPdf] iOS other browser - using FileReader + window.open approach');
    if (preOpenedWindow) preOpenedWindow.close();

    const pdfBlob = new Blob([blob], { type: 'application/pdf' });
    const success = await openViaDataUrlInNewWindow(pdfBlob, filename);
    
    if (!success) {
      // Fallback to anchor
      const downloadBlob = new Blob([blob], { type: 'application/octet-stream' });
      const downloadUrl = URL.createObjectURL(downloadBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
    }
    return true;
  }

  // Android non-Chrome: use Data URL approach as well (more reliable on mobile)
  if (isAndroid) {
    console.log('[downloadPdf] Android non-Chrome - using Data URL approach');
    if (preOpenedWindow) preOpenedWindow.close();

    const downloadBlob = new Blob([blob], { type: 'application/octet-stream' });
    const success = await downloadViaDataUrl(downloadBlob, filename);
    if (success) return true;

    // Fallback
    const url = URL.createObjectURL(downloadBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }

  // Desktop: standard download
  console.log('[downloadPdf] Desktop browser - using standard blob URL download');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Pre-opens a window for iOS browsers to avoid popup blocker
 * Currently not needed - both Safari and Chrome use anchor download method
 * Keeping for potential future fallback needs
 * Must be called synchronously from a user gesture (click handler)
 */
export function preOpenWindowForIOS(): Window | null {
  // Both Safari and Chrome iOS now use anchor download - no pre-opened window needed
  return null;
}

export { getDeviceInfo };
