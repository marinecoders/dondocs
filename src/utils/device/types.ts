/**
 * Device Detection Types
 * ======================
 */

/**
 * Comprehensive device information
 */
export interface DeviceInfo {
  // === Platform Detection ===
  
  /** Any iOS device (iPhone, iPad, iPod) */
  isIOS: boolean;
  
  /** iPad specifically (includes "desktop mode" iPads that report as Macintosh) */
  isIPad: boolean;
  
  /** iPhone or iPod (phones, not tablets) */
  isIPhone: boolean;
  
  /** Any Android device */
  isAndroid: boolean;
  
  /** Any mobile device (iOS or Android, phones or tablets) */
  isMobile: boolean;
  
  /** Desktop/laptop computer */
  isDesktop: boolean;
  
  // === Browser Detection ===
  
  /** Safari browser (real Safari, not in-app browser) */
  isSafari: boolean;
  
  /** 
   * "Real" Safari - the actual Safari app, not an in-app browser
   * that identifies as Safari in user agent
   */
  isRealSafari: boolean;
  
  /** Chrome on iOS (uses "CriOS" in user agent) */
  isChromeIOS: boolean;
  
  /** Chrome browser (any platform) */
  isChrome: boolean;
  
  /** Firefox on iOS (uses "FxiOS" in user agent) */
  isFirefoxIOS: boolean;
  
  /** Firefox browser (any platform) */
  isFirefox: boolean;
  
  /** Edge browser */
  isEdge: boolean;
  
  // === In-App Browser Detection ===
  // These are WebViews embedded in apps, NOT standalone browsers
  // They have severe limitations with blob URLs and downloads
  
  /** Google Search App's in-app browser */
  isGoogleApp: boolean;
  
  /** Facebook app's in-app browser */
  isFacebookApp: boolean;
  
  /** Instagram app's in-app browser */
  isInstagramApp: boolean;
  
  /** Twitter/X app's in-app browser */
  isTwitterApp: boolean;
  
  /** LinkedIn app's in-app browser */
  isLinkedInApp: boolean;
  
  /** 
   * Any in-app browser (WKWebView-based on iOS)
   * IMPORTANT: These have broken blob URL support!
   */
  isInAppBrowser: boolean;
  
  // === Raw User Agent ===
  userAgent: string;
}

/**
 * PDF download strategy recommendation
 */
export type PdfDownloadStrategy = 
  | 'blob-anchor'      // Standard: create blob URL, trigger anchor click
  | 'data-url-anchor'  // Convert to data URL, trigger anchor click
  | 'data-url-window'  // Convert to data URL, open in new window
  | 'blob-window'      // Create blob URL, open in new window
  | 'show-instructions' // Can't download - show user instructions
  ;

/**
 * Combined strategy recommendations for a device. Preview is not part of the
 * strategy anymore: every platform renders through the shared in-app viewer
 * (src/components/pdf/PdfViewer.tsx).
 */
export interface DeviceStrategy {
  download: PdfDownloadStrategy;

  /** Human-readable explanation of why this strategy was chosen */
  reasoning: string;
}
