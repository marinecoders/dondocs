import { flushDocumentWrites } from '@/stores/documentsStore';
import { showAppAlert } from '@/stores/alertStore';
/**
 * PWA service-worker registration and update handling (vite-plugin-pwa's
 * useRegisterSW in prompt mode). Updates expose a passive action; the user
 * opens confirmation explicitly. Pending saves still commit before activation.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useReleaseUpdates } from './useReleaseUpdates';

// Key to signal auto-restore after update reload
export const SW_AUTO_RESTORE_KEY = 'dondocs-sw-auto-restore';

function useLegacyServiceWorker() {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  // Periodic update-check interval, cancelled on unmount so dev HMR and tests
  // don't leak a 60s timer calling registration.update() against a dead component.
  const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The live registration, so the focus/reconnect listeners below can trigger an
  // immediate update check (not just wait for the next 60s tick).
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloading = useRef(false);
  const activationCleanup = useRef<(() => void) | null>(null);
  const reloadOnce = useCallback(() => {
    if (reloading.current) return;
    reloading.current = true;
    void flushDocumentWrites().then(() => window.location.reload()).catch(error => {
      reloading.current = false;
      showAppAlert({ title: 'Update paused', message: error instanceof Error ? error.message : String(error) });
    });
  }, []);

  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload: reloadOnce,
    onRegisteredSW(swUrl, registration) {
      console.log('[SW] Registered:', swUrl);

      // Poll for updates every 60s. Clear any prior interval in case
      // onRegisteredSW fires more than once (e.g. dev re-registration).
      if (registration) {
        registrationRef.current = registration;
        if (updateIntervalRef.current) {
          clearInterval(updateIntervalRef.current);
        }
        updateIntervalRef.current = setInterval(() => {
          void registration.update().catch(() => {});
        }, 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('[SW] Registration error:', error);
    },
  });

  const activateUpdate = useCallback(async (update: ((reload?: boolean) => Promise<void>) | null) => {
    await flushDocumentWrites();
    // Resolve the live registration at confirmation time; the prompt can arrive
    // before the registration callback exposes the waiting worker.
    const registration = await navigator.serviceWorker?.getRegistration?.() ?? registrationRef.current;
    const offered = registration?.waiting ?? registration?.installing ?? registration?.active;
    if (offered) {
      activationCleanup.current?.();
      const activated = () => {
        if (offered.state !== 'activated') return;
        activationCleanup.current?.();
        reloadOnce();
      };
      offered.addEventListener('statechange', activated);
      activationCleanup.current = () => offered.removeEventListener('statechange', activated);
      activated();
    }
    await update?.(true);
  }, [reloadOnce]);

  // A first-install tab is uncontrolled until navigation. Without clientsClaim,
  // activating an update does not send it controllerchange. Observe the offered
  // worker as well so this tab reloads once activation has actually completed.
  useEffect(() => {
    const worker = navigator.serviceWorker;
    if (!needRefresh || !worker) return;
    const registration = registrationRef.current;
    const waiting = registration?.waiting ?? registration?.installing ?? registration?.active;
    const onStateChange = () => {
      if (waiting?.state === 'activated') reloadOnce();
    };
    worker.addEventListener('controllerchange', reloadOnce);
    waiting?.addEventListener('statechange', onStateChange);
    onStateChange();
    return () => {
      worker.removeEventListener('controllerchange', reloadOnce);
      waiting?.removeEventListener('statechange', onStateChange);
    };
  }, [needRefresh, reloadOnce]);

  // Clean up the update-check interval on unmount.
  useEffect(() => {
    return () => {
      activationCleanup.current?.();
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
    };
  }, []);

  // Check for a new build the moment a long-lived session comes back to life —
  // when the tab is refocused or the network reconnects — instead of waiting up
  // to 60s for the next poll (or the browser's own ~24h check). This is what
  // gets a fresh build to users who leave the app open for hours/days.
  useEffect(() => {
    const checkNow = () => {
      if (document.visibilityState === 'visible') {
        registrationRef.current?.update().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', checkNow);
    window.addEventListener('focus', checkNow);
    window.addEventListener('online', checkNow);
    return () => {
      document.removeEventListener('visibilitychange', checkNow);
      window.removeEventListener('focus', checkNow);
      window.removeEventListener('online', checkNow);
    };
  }, []);

  // Local inspection only: expose the action without installing a worker.
  const updateAvailable = needRefresh || (
    import.meta.env.DEV && new URLSearchParams(window.location.search).get('previewUpdate') === '1'
  );
  const promptUpdate = useCallback(() => {
    if (updateAvailable) setShowUpdatePrompt(true);
  }, [updateAvailable]);

  // User confirms the update, so reload. documentsStore.init auto-resumes the open
  // document, so there's no restore prompt to pre-empt.
  const confirmUpdate = useCallback(() => {
    console.log('[SW] User confirmed update, reloading');
    setShowUpdatePrompt(false);
    void activateUpdate(updateServiceWorker).catch(error => {
      showAppAlert({ title: 'Update paused', message: String(error) });
    });
  }, [updateServiceWorker, activateUpdate]);

  // User dismisses update prompt (update later)
  const dismissUpdatePrompt = useCallback(() => {
    setShowUpdatePrompt(false);
  }, []);

  return {
    updateAvailable,
    promptUpdate,
    showUpdatePrompt,
    confirmUpdate,
    dismissUpdatePrompt,
    offlineReady,
  };
}

export const useServiceWorker = __RELEASE_ID__ ? useReleaseUpdates : useLegacyServiceWorker;
