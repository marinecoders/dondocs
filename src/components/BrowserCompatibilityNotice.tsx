/**
 * Browser Compatibility Notice
 * ============================
 * 
 * Shows a notice to users in incompatible browsers (in-app browsers)
 * explaining that some features (like PDF downloads) won't work and listing
 * compatible browsers they can use instead.
 * 
 * NOTE: This shows EVERY TIME on incompatible browsers - no dismiss persistence.
 * 
 * WHY: In-app browsers (Google App, Facebook, Instagram, etc.) use WKWebView
 * which has fundamental limitations with blob URL downloads. There is NO
 * JavaScript-only fix for this - it requires native app code changes.
 * See: https://bugs.webkit.org/show_bug.cgi?id=216918
 */

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, X, ExternalLink } from 'lucide-react';
import { getDeviceInfo, type DeviceInfo } from '@/utils/device';

// Browser icons as simple SVG components
function SafariIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm.707-11.707l-4 4a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 1.414zm2.586 2.586l-4 4a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 1.414z"/>
    </svg>
  );
}

function ChromeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>
    </svg>
  );
}

function FirefoxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
    </svg>
  );
}

function EdgeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
    </svg>
  );
}

interface CompatibleBrowser {
  name: string;
  icon: React.ReactNode;
  description: string;
}

const COMPATIBLE_BROWSERS: CompatibleBrowser[] = [
  {
    name: 'Safari',
    icon: <SafariIcon className="h-6 w-6" />,
    description: 'Best experience on iOS',
  },
  {
    name: 'Chrome',
    icon: <ChromeIcon className="h-6 w-6" />,
    description: 'Full feature support',
  },
  {
    name: 'Firefox',
    icon: <FirefoxIcon className="h-6 w-6" />,
    description: 'Full feature support',
  },
  {
    name: 'Edge',
    icon: <EdgeIcon className="h-6 w-6" />,
    description: 'Full feature support',
  },
];

function getInAppBrowserName(device: DeviceInfo): string {
  if (device.isGoogleApp) return 'Google app';
  if (device.isFacebookApp) return 'Facebook';
  if (device.isInstagramApp) return 'Instagram';
  if (device.isTwitterApp) return 'Twitter/X';
  if (device.isLinkedInApp) return 'LinkedIn';
  return 'this app';
}

export function BrowserCompatibilityNotice() {
  const [isVisible, setIsVisible] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);

  useEffect(() => {
    const device = getDeviceInfo();
    setDeviceInfo(device);

    // Log full device info for debugging
    console.log('[BrowserNotice] Full device info:', JSON.stringify(device, null, 2));
    console.log('[BrowserNotice] User agent:', navigator.userAgent);

    // Only show for in-app browsers
    if (!device.isInAppBrowser) {
      console.log('[BrowserNotice] Not an in-app browser, skipping.');
      return;
    }

    // Show notice immediately - welcome modal is skipped for in-app browsers
    console.log('[BrowserNotice] In-app browser detected, showing notice immediately');
    setIsVisible(true);
  }, []);

  const handleDismiss = useCallback(() => {
    console.log('[BrowserNotice] Dismiss clicked');
    // No localStorage - just hide for this session
    setIsVisible(false);
  }, []);

  const handleOpenInSafari = useCallback(async () => {
    console.log('[BrowserNotice] Open in Safari clicked');
    
    // Copy URL to clipboard so user can paste in Safari
    const currentUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(currentUrl);
      alert('URL copied to clipboard!\n\nTo open in Safari:\n1. Open Safari app\n2. Paste the URL in the address bar\n\nOr:\n1. Tap the ⋮ or share button in this browser\n2. Select "Open in Safari"');
    } catch {
      // Clipboard API might not work, just show instructions
      alert('To open in Safari:\n\n1. Tap the ⋮ or share button at the top/bottom of your screen\n2. Select "Open in Safari" or "Open in Browser"');
    }
  }, []);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    // Only dismiss if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget) {
      handleDismiss();
    }
  }, [handleDismiss]);

  if (!isVisible || !deviceInfo) {
    return null;
  }

  const appName = getInAppBrowserName(deviceInfo);

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div 
        className="bg-card border border-border rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-full">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <h2 className="font-semibold text-lg">Limited Browser Support</h2>
              <p className="text-sm text-muted-foreground">Some features may not work</p>
            </div>
          </div>
          <button
            type="button"
            className="h-8 w-8 -mt-1 -mr-1 rounded-md flex items-center justify-center hover:bg-muted transition-colors"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            You're viewing this in <strong className="text-foreground">{appName}'s</strong> built-in browser, 
            which has limited support for some features like <strong className="text-foreground">PDF downloads</strong>.
          </p>

          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-sm font-medium mb-3">For the best experience, use one of these browsers:</p>
            <div className="grid grid-cols-2 gap-2">
              {COMPATIBLE_BROWSERS.map((browser) => (
                <div
                  key={browser.name}
                  className="flex items-center gap-2 p-2 bg-background rounded-md border border-border"
                >
                  <div className="text-primary">{browser.icon}</div>
                  <div>
                    <p className="text-sm font-medium">{browser.name}</p>
                    <p className="text-xs text-muted-foreground">{browser.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
            <p className="text-sm font-medium text-primary mb-1">How to open in Safari:</p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Tap the <strong>⋮</strong> or <strong>share</strong> button</li>
              <li>Select <strong>"Open in Safari"</strong></li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex gap-2">
          <button
            type="button"
            className="flex-1 px-4 py-2 text-sm font-medium border border-border rounded-md hover:bg-muted transition-colors"
            onClick={handleDismiss}
          >
            Continue Anyway
          </button>
          <button
            type="button"
            className="flex-1 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            onClick={handleOpenInSafari}
          >
            <ExternalLink className="h-4 w-4" />
            Copy Link & Instructions
          </button>
        </div>
      </div>
    </div>
  );
}
