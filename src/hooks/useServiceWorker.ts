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
export const SW_AUTO_RESTORE_KEY = 'libo-sw-auto-restore';

export function useServiceWorker() {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [isActiveSession, setIsActiveSession] = useState(false);
  const updateServiceWorkerRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      console.log('[SW] Registered:', swUrl);

      // Check for updates periodically (every 60 seconds)
      if (registration) {
        setInterval(() => {
          registration.update();
        }, 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('[SW] Registration error:', error);
    },
  });

  // Store updateServiceWorker in ref for use in effects
  updateServiceWorkerRef.current = updateServiceWorker;

  // Mark session as active after 5 seconds of being on the page
  // This means: fresh visit = auto-update, active session = prompt
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('[SW] Session now active - updates will prompt');
      setIsActiveSession(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // When needRefresh is true, either auto-update or show prompt
  useEffect(() => {
    if (needRefresh) {
      if (isActiveSession) {
        // User is actively working - show prompt
        console.log('[SW] Update available, prompting user (active session)');
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
