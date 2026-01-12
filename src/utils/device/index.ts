/**
 * Device Detection Utilities
 * ==========================
 * 
 * This module provides comprehensive device and browser detection for handling
 * platform-specific behavior, especially for PDF viewing and downloading.
 * 
 * WHY WE NEED THIS:
 * -----------------
 * Different platforms have wildly different capabilities for handling PDFs:
 * 
 * 1. BLOB URLs: Work on desktop, broken on most iOS browsers
 * 2. Data URLs: Work on iOS Chrome, may hit size limits
 * 3. Download attribute: Works on desktop/Android, broken on iOS Chrome
 * 4. Native PDF viewing: Excellent on Safari, varies elsewhere
 * 
 * ARCHITECTURE:
 * -------------
 * - index.ts: Main exports and combined detection
 * - types.ts: TypeScript interfaces
 * - detectors.ts: Individual detection functions
 * - strategies.ts: Platform-specific strategy recommendations
 * 
 * KNOWN BROWSER QUIRKS (as of 2024):
 * ----------------------------------
 * 
 * iOS Safari:
 *   - Blob URLs: ✅ Work
 *   - Download attribute: ✅ Works with octet-stream
 *   - Native PDF: ✅ Excellent
 * 
 * iOS Chrome (CriOS):
 *   - Blob URLs: ❌ Open blank page (WebKit bug #216918)
 *   - Download attribute: ❌ Broken with blob URLs
 *   - Data URLs: ✅ Work with FileReader + window.open
 *   - Native PDF: ✅ Good (via data URL)
 * 
 * iOS In-App Browsers (Google App, Facebook, Instagram, etc.):
 *   - Blob URLs: ❌ Completely broken (WKWebView limitation)
 *   - Download attribute: ❌ Broken
 *   - Data URLs: ❌ Often show blank page
 *   - Solution: Tell user to open in Safari
 * 
 * Android Chrome:
 *   - Blob URLs: ⚠️ Sometimes fail silently
 *   - Data URLs: ✅ Work reliably
 *   - Download attribute: ✅ Works
 * 
 * Desktop (Chrome, Firefox, Safari, Edge):
 *   - Everything works ✅
 * 
 * REFERENCES:
 * -----------
 * - WebKit Bug #216918: https://bugs.webkit.org/show_bug.cgi?id=216918
 * - FileSaver.js iOS issues: https://github.com/eligrey/FileSaver.js/issues/686
 * - react-pdf iOS issues: https://github.com/wojtekmaj/react-pdf/issues/1601
 */

export * from './types';
export * from './detectors';
export * from './strategies';
export { getDeviceInfo, useDeviceInfo } from './detectors';
