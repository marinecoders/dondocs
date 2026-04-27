/**
 * Idle-time prefetch of the Pandoc WASM module (~58 MB).
 *
 * The first DOCX export downloads the Pandoc WASM binary from unpkg, plus
 * a small WASI shim from jsdelivr. On a typical connection that's a
 * 5-15s wait between the user clicking "Download DOCX" and the file
 * actually being generated -- a noticeably bad first-time experience.
 *
 * This hook fires `prefetchPandocModule()` shortly after the page is
 * idle, populating the in-memory singleton + workbox runtime cache in
 * the background. By the time the user actually clicks DOCX export, the
 * WASM is already loaded; the export feels instant.
 *
 * Connection gating
 * -----------------
 *
 * The 58 MB download is non-trivial on cellular / metered connections,
 * and most users never export DOCX. We skip the prefetch when:
 *
 *   - `navigator.onLine === false` (obviously)
 *   - `navigator.connection.saveData === true` (user opted in to
 *     data-saver mode)
 *   - `navigator.connection.effectiveType` is `slow-2g` or `2g`
 *     (very slow connection -- the prefetch would compete with the
 *     user's actual interactions)
 *
 * Not all browsers expose `navigator.connection` (Safari notably
 * doesn't). When the API is unavailable we proceed with the prefetch,
 * accepting that we may occasionally prefetch on a metered connection
 * we couldn't detect. That trade-off is acceptable because the
 * alternative -- never prefetching when we can't detect connection
 * type -- would penalize the majority of users on Safari.
 *
 * Idle scheduling
 * ---------------
 *
 * Uses `requestIdleCallback` with a 10s timeout so the prefetch fires
 * even if the page stays busy. Falls back to a `setTimeout` of 2s on
 * browsers without `requestIdleCallback` (Safari again).
 */

import { useEffect } from 'react';
import { prefetchPandocModule } from '@/services/docx/pandoc-converter';
import { debug } from '@/lib/debug';

// Subset of the Network Information API we care about. Optional fields
// because the API is not universally supported.
interface NetworkInformation {
  saveData?: boolean;
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
}

function getNetworkInformation(): NetworkInformation | undefined {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

function shouldPrefetchOnThisConnection(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  const conn = getNetworkInformation();
  if (!conn) {
    // Connection API unavailable (e.g. Safari) -- proceed.
    return true;
  }
  if (conn.saveData === true) {
    return false;
  }
  if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') {
    return false;
  }
  return true;
}

// `requestIdleCallback` is supported in Chrome / Edge / Firefox but not in
// Safari (as of late 2025), so we read both off `window` directly and
// branch at runtime.
const win = typeof window !== 'undefined'
  ? (window as Window & {
      requestIdleCallback?: typeof requestIdleCallback;
      cancelIdleCallback?: typeof cancelIdleCallback;
    })
  : undefined;

export function usePandocIdlePrefetch() {
  useEffect(() => {
    if (!shouldPrefetchOnThisConnection()) {
      debug.verbose('Prefetch', 'Skipping Pandoc prefetch (offline / data-saver / slow connection)');
      return;
    }

    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const fire = () => {
      debug.log('Prefetch', 'Browser idle: prefetching Pandoc WASM in background');
      // Don't await -- we want this to be fire-and-forget. The function
      // itself swallows errors; nothing depends on the return value.
      void prefetchPandocModule();
    };

    if (win && typeof win.requestIdleCallback === 'function') {
      // Run when the browser is genuinely idle. The 10s timeout ensures
      // we eventually fire even on a perpetually-busy page.
      idleHandle = win.requestIdleCallback(fire, { timeout: 10_000 });
    } else {
      // Safari fallback: a generous timeout so the page has time to
      // settle before we start a 58 MB download.
      timeoutHandle = setTimeout(fire, 2000);
    }

    return () => {
      if (idleHandle !== null && win && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    };
  }, []);
}
