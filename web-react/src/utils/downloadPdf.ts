/**
 * Cross-platform PDF download utility
 * Handles iOS Safari, iOS Chrome, and desktop browsers
 */

interface DeviceInfo {
  isIOS: boolean;
  isIPad: boolean;
  isSafari: boolean;
}

function getDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent;
  const isIPad = /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) && 'ontouchstart' in window);
  const isIOS = /iPhone|iPod/i.test(ua) || isIPad;

  // Chrome on iOS uses "CriOS", Chrome desktop uses "Chrome"
  // Edge uses "Edg", Firefox uses "FxiOS" on iOS
  const isChrome = /Chrome|CriOS/i.test(ua);
  const isFirefox = /Firefox|FxiOS/i.test(ua);
  const isEdge = /Edg/i.test(ua);

  // Safari is true only if it says Safari AND is not Chrome/Firefox/Edge
  const isSafari = /Safari/i.test(ua) && !isChrome && !isFirefox && !isEdge;

  console.log('[downloadPdf] UA:', ua);
  console.log('[downloadPdf] isIOS:', isIOS, 'isSafari:', isSafari, 'isChrome:', isChrome);

  return { isIOS, isIPad, isSafari };
}

/**
 * Downloads a PDF blob with platform-specific handling
 * For iOS Safari: opens instructions page, then PDF on button click
 * For iOS Chrome: opens PDF directly (Chrome has native download UI)
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
  const { isIOS, isSafari } = getDeviceInfo();
  const file = new File([blob], filename, { type: 'application/pdf' });

  // iOS Safari: use anchor download with octet-stream (skip Web Share API - anchor works better)
  if (isIOS && isSafari) {
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

  // iOS non-Safari (Chrome, Firefox, Edge): try Web Share API first, then data URL
  if (isIOS && !isSafari && navigator.share && navigator.canShare) {
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        if (preOpenedWindow) preOpenedWindow.close();
        return true;
      } catch (shareErr) {
        if ((shareErr as Error).name === 'AbortError') {
          if (preOpenedWindow) preOpenedWindow.close();
          return true;
        }
        console.log('Share API failed, using fallback:', shareErr);
      }
    }
  }

  // iOS non-Safari (Chrome, Firefox, Edge): use data URL approach
  // This must come BEFORE Safari check since blob URLs don't work in Chrome iOS
  // Reference: https://github.com/nicbarker/pdf-viewer/issues/629
  if (isIOS && !isSafari) {
    console.log('[downloadPdf] Using data URL approach for non-Safari iOS browser');
    if (preOpenedWindow) preOpenedWindow.close();

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        window.open(dataUrl, '_blank');
        resolve(true);
      };
      reader.onerror = () => {
        console.error('Failed to read PDF as data URL');
        resolve(false);
      };
      reader.readAsDataURL(blob);
    });
  }

  /*
  // Old fallback for iOS Safari - keeping for reference
  if (isIOS && isSafari && preOpenedWindow) {
    const pdfBlobUrl = URL.createObjectURL(blob);
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>Save PDF</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      display: flex; align-items: center; justify-content: center; padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .card {
      background: #fff; border-radius: 20px; padding: 32px 24px;
      max-width: 340px; width: 100%; text-align: center;
      box-shadow: 0 25px 80px rgba(0,0,0,0.4);
    }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h1 { font-size: 22px; margin-bottom: 8px; color: #1a1a1a; font-weight: 700; }
    .subtitle { font-size: 14px; color: #666; margin-bottom: 24px; }
    .steps { text-align: left; margin-bottom: 28px; }
    .step { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
    .step-num {
      width: 28px; height: 28px; background: #007AFF; color: white;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 600; flex-shrink: 0;
    }
    .step-text { font-size: 15px; color: #333; line-height: 1.4; padding-top: 3px; }
    .step-text strong { color: #007AFF; }
    button {
      width: 100%; padding: 16px; background: #007AFF; color: white;
      border: none; border-radius: 12px; font-size: 17px; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
    }
    button:active { background: #0056b3; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📄</div>
    <h1>Ready to Save</h1>
    <p class="subtitle">After viewing the PDF, save it using these steps:</p>
    <div class="steps">
      <div class="step">
        <span class="step-num">1</span>
        <span class="step-text">Tap the <strong>Share button</strong> (↑) in the toolbar</span>
      </div>
      <div class="step">
        <span class="step-num">2</span>
        <span class="step-text">Select <strong>"Save to Files"</strong> or <strong>"Save PDF"</strong></span>
      </div>
    </div>
    <button onclick="window.location.href='${pdfBlobUrl}'">View PDF</button>
  </div>
</body>
</html>`;
    preOpenedWindow.document.open();
    preOpenedWindow.document.write(htmlContent);
    preOpenedWindow.document.close();
    return true;
  }
  */

  // Desktop: standard download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Pre-opens a window for iOS Chrome to avoid popup blocker
 * Safari doesn't need this - it uses anchor download method
 * Must be called synchronously from a user gesture (click handler)
 */
export function preOpenWindowForIOS(): Window | null {
  const { isIOS, isSafari } = getDeviceInfo();
  // Only pre-open for iOS non-Safari browsers (Chrome needs it for data URL approach)
  if (isIOS && !isSafari) {
    return window.open('about:blank', '_blank');
  }
  return null;
}

export { getDeviceInfo };
