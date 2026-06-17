/**
 * PWA service-worker registration and update handling (vite-plugin-pwa's
 * useRegisterSW in prompt mode). Fresh visits (within 5s) auto-update silently;
 * active sessions prompt first. Work is auto-restored after the reload.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Key to signal auto-restore after update reload
export const SW_AUTO_RESTORE_KEY = 'dondocs-sw-auto-restore';

export function useServiceWorker() {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [isActiveSession, setIsActiveSession] = useState(false);
  const updateServiceWorkerRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  // Periodic update-check interval, cancelled on unmount so dev HMR and tests
  // don't leak a 60s timer calling registration.update() against a dead component.
  const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      console.log('[SW] Registered:', swUrl);

      // Poll for updates every 60s. Clear any prior interval in case
      // onRegisteredSW fires more than once (e.g. dev re-registration).
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

  // Keep the latest updateServiceWorker in a ref so the needRefresh effect can
  // call it without depending on it (its closure identity changes each render).
  // Assign in an effect, not during render, to stay safe under concurrent
  // rendering; the consumer effect is declared after this one, so the ref is
  // populated first.
  useEffect(() => {
    updateServiceWorkerRef.current = updateServiceWorker;
  }, [updateServiceWorker]);

  // Mark the session active after 5s: fresh visit auto-updates, active session
  // prompts.
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log('[SW] Session now active - updates will prompt');
      setIsActiveSession(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // When needRefresh flips true, auto-update or show the prompt. useRegisterSW
  // exposes it as a derived value, so the effect mirrors it into local UI state.
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

  // User confirms the update, so reload. documentsStore.init auto-resumes the open
  // document, so there's no restore prompt to pre-empt.
  const confirmUpdate = useCallback(() => {
    console.log('[SW] User confirmed update, reloading');
    setShowUpdatePrompt(false);
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
