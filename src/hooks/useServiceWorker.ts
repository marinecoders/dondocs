/**
 * Service Worker Registration Hook
 *
 * Handles PWA service worker registration and update notifications.
 * Uses vite-plugin-pwa's useRegisterSW hook with prompt mode.
 *
 * When an update is detected, prompts the user before reloading.
 * After reload, automatically restores their work without prompting.
 *
 * @version 1.1.0
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const SW_UPDATE_KEY = 'libo-sw-updated';
const SW_UPDATE_SHOWN_KEY = 'libo-sw-update-shown';
// Key to signal auto-restore after update reload
export const SW_AUTO_RESTORE_KEY = 'libo-sw-auto-restore';

export function useServiceWorker() {
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);
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
        localStorage.setItem(SW_UPDATE_KEY, Date.now().toString());
        updateServiceWorkerRef.current?.(true);
      }
    }
  }, [needRefresh, isActiveSession]);

  // User confirms update - save state and reload
  const confirmUpdate = useCallback(() => {
    console.log('[SW] User confirmed update, marking for auto-restore');
    // Mark that we should auto-restore after reload (skip restore modal)
    localStorage.setItem(SW_AUTO_RESTORE_KEY, 'true');
    localStorage.setItem(SW_UPDATE_KEY, Date.now().toString());
    setShowUpdatePrompt(false);
    // Trigger the service worker update which will reload the page
    updateServiceWorker(true);
  }, [updateServiceWorker]);

  // User dismisses update prompt (update later)
  const dismissUpdatePrompt = useCallback(() => {
    setShowUpdatePrompt(false);
  }, []);

  // Check if we just loaded after an update
  useEffect(() => {
    const updateTimestamp = localStorage.getItem(SW_UPDATE_KEY);
    const alreadyShown = sessionStorage.getItem(SW_UPDATE_SHOWN_KEY);

    if (updateTimestamp && !alreadyShown) {
      const updateTime = parseInt(updateTimestamp, 10);
      const now = Date.now();

      // Show banner if update was within the last 30 seconds
      // This means the page just reloaded with new content
      if (now - updateTime < 30000) {
        console.log('[SW] Just updated, showing banner');
        setShowUpdateBanner(true);
        sessionStorage.setItem(SW_UPDATE_SHOWN_KEY, 'true');
        localStorage.removeItem(SW_UPDATE_KEY);

        // Auto-hide after 10 seconds
        setTimeout(() => {
          setShowUpdateBanner(false);
        }, 10000);
      } else {
        // Old update marker, clean it up
        localStorage.removeItem(SW_UPDATE_KEY);
      }
    }
  }, []);

  const dismissBanner = useCallback(() => {
    setShowUpdateBanner(false);
  }, []);

  return {
    showUpdateBanner,
    showUpdatePrompt,
    dismissBanner,
    confirmUpdate,
    dismissUpdatePrompt,
    offlineReady,
  };
}
