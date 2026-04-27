/**
 * Service Worker Registration Hook
 *
 * Handles PWA service worker registration and update notifications.
 * Uses vite-plugin-pwa's useRegisterSW hook with prompt mode.
 *
 * - Fresh visits (within 5 seconds): auto-update silently
 * - Active sessions (after 5 seconds): prompt user before updating
 * - After reload: automatically restores their work without prompting
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Key to signal auto-restore after update reload
export const SW_AUTO_RESTORE_KEY = 'dondocs-sw-auto-restore';

export function useServiceWorker() {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [isActiveSession, setIsActiveSession] = useState(false);
  const updateServiceWorkerRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  // Track the periodic update-check interval so we can cancel it on unmount.
  // Without this, HMR in dev and any unmount in tests leak a 60s timer that
  // keeps calling registration.update() forever against a dead component.
  const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      console.log('[SW] Registered:', swUrl);

      // Check for updates periodically (every 60 seconds). Clear any prior
      // interval first in case onRegisteredSW fires more than once (e.g.
      // registration re-runs in dev).
      if (registration) {
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
        }
        updateIntervalRef.current = setInterval(() => {
          registration.update();
        }, 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('[SW] Registration error:', error);
    },
  });

  // Clean up the update-check interval on unmount.
  useEffect(() => {
    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
    };
  }, []);

  // Sync the latest updateServiceWorker callback into a ref so the
  // needRefresh effect below can call it without listing it as a dep.
  // (Adding the callback to that effect's deps would cause spurious
  // re-runs on every render where useRegisterSW returns a new closure
  // identity, which can flip needRefresh handling mid-cycle.)
  //
  // Setting `ref.current` in render directly works in practice but
  // violates the React rule against side-effects during render and
  // is brittle under concurrent rendering -- React may discard a
  // render and re-run it, leaving the ref pointing at a stale closure
  // from the discarded attempt. Move the assignment into useEffect so
  // it runs after the render commits. The ref consumer below is also
  // a useEffect and is declared after this one, so React runs them in
  // order and the ref is always populated before the consumer reads it.
  useEffect(() => {
    updateServiceWorkerRef.current = updateServiceWorker;
  }, [updateServiceWorker]);

  // Mark session as active after 5 seconds of being on the page
  // This means: fresh visit = auto-update, active session = prompt
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('[SW] Session now active - updates will prompt');
      setIsActiveSession(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // When needRefresh is true, either auto-update or show prompt.
  //
  // Legitimate "synchronize React state with an external system" pattern:
  // useRegisterSW exposes `needRefresh` as a derived value (not a stream
  // or listener callback), so our effect mirrors it into local UI state
  // when it flips true. The react-hooks/set-state-in-effect rule docs
  // explicitly call out "subscribe for updates from some external system,
  // calling setState when external state changes" as legitimate -- this
  // is the same shape, just expressed via a value-prop API rather than
  // a callback-listener API. The rule is conservative about flagging
  // synchronous setState in the effect body, so the disable is at the
  // setShowUpdatePrompt call.
  useEffect(() => {
    if (needRefresh) {
      if (isActiveSession) {
        // User is actively working - show prompt
        console.log('[SW] Update available, prompting user (active session)');
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShowUpdatePrompt(true);
      } else {
        // Fresh visit - auto-update silently
        console.log('[SW] Update available, auto-updating (fresh visit)');
        updateServiceWorkerRef.current?.(true);
      }
    }
  }, [needRefresh, isActiveSession]);

  // User confirms update - save state and reload
  const confirmUpdate = useCallback(() => {
    console.log('[SW] User confirmed update, marking for auto-restore');
    // Mark that we should auto-restore after reload (skip restore modal)
    localStorage.setItem(SW_AUTO_RESTORE_KEY, 'true');
    setShowUpdatePrompt(false);
    // Trigger the service worker update which will reload the page
    updateServiceWorker(true);
  }, [updateServiceWorker]);

  // User dismisses update prompt (update later)
  const dismissUpdatePrompt = useCallback(() => {
    setShowUpdatePrompt(false);
  }, []);

  return {
    showUpdatePrompt,
    confirmUpdate,
    dismissUpdatePrompt,
    offlineReady,
  };
}
