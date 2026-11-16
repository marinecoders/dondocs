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

type UpdateAttempt = { phase: 'saving' | 'activating' | 'waiting'; reloadRequested: boolean };

function useLegacyServiceWorker() {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [updating, setUpdating] = useState(false);
  // Periodic update-check interval, cancelled on unmount so dev HMR and tests
  // don't leak a 60s timer calling registration.update() against a dead component.
  const updateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The live registration, so the focus/reconnect listeners below can trigger an
  // immediate update check (not just wait for the next 60s tick).
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const mounted = useRef(true);
  const updateAttempt = useRef<UpdateAttempt | null>(null);
  const reloading = useRef(false);
  const activationCleanup = useRef<(() => void) | null>(null);
  const pauseUpdate = useCallback((attempt: UpdateAttempt, message: string) => {
    if (!mounted.current || updateAttempt.current !== attempt) return;
    updateAttempt.current = null;
    reloading.current = false;
    setUpdating(false);
    activationCleanup.current?.();
    activationCleanup.current = null;
    showAppAlert({ title: 'Update paused', message });
  }, []);
  const reloadOnce = useCallback(() => {
    const attempt = updateAttempt.current;
    if (!mounted.current || !attempt || attempt.phase === 'saving') return;
    attempt.reloadRequested = true;
    // Activation can notify synchronously. Wait for the confirmed activation
    // request to succeed before accepting that notification as a reload.
    if (attempt.phase !== 'waiting' || reloading.current) return;
    reloading.current = true;
    activationCleanup.current?.();
    activationCleanup.current = null;
    void flushDocumentWrites().then(() => {
      if (mounted.current && updateAttempt.current === attempt) window.location.reload();
    }).catch(error => {
      pauseUpdate(attempt, error instanceof Error ? error.message : String(error));
    });
  }, [pauseUpdate]);

  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload: reloadOnce,
    onRegisteredSW(swUrl, registration) {
      if (!mounted.current) return;
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

  const activateUpdate = useCallback(async (update: ((reload?: boolean) => Promise<void>) | null, attempt: UpdateAttempt) => {
    await flushDocumentWrites();
    if (!mounted.current || updateAttempt.current !== attempt) return;
    // Resolve the live registration at confirmation time; the prompt can arrive
    // before the registration callback exposes the waiting worker.
    const registration = await navigator.serviceWorker?.getRegistration?.() ?? registrationRef.current;
    if (!mounted.current || updateAttempt.current !== attempt) return;
    attempt.phase = 'activating';
    const worker = navigator.serviceWorker;
    const offered = registration?.waiting ?? registration?.installing ?? registration?.active;
    const notify = () => {
      if (mounted.current && updateAttempt.current === attempt) reloadOnce();
    };
    // A first-install tab may receive no controllerchange without clientsClaim.
    // Observe only this confirmed attempt's live offered worker as well.
    const onActivated = () => { if (offered?.state === 'activated') notify(); };
    worker?.addEventListener('controllerchange', notify);
    offered?.addEventListener('statechange', onActivated);
    activationCleanup.current = () => {
      worker?.removeEventListener('controllerchange', notify);
      offered?.removeEventListener('statechange', onActivated);
    };
    await update?.(true);
    if (!mounted.current || updateAttempt.current !== attempt) return;
    attempt.phase = 'waiting';
    onActivated();
    if (attempt.reloadRequested) reloadOnce();
  }, [reloadOnce]);

  // Clean up the update-check interval on unmount.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      updateAttempt.current = null;
      reloading.current = false;
      activationCleanup.current?.();
      activationCleanup.current = null;
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
    if (!mounted.current || updateAttempt.current) return;
    const attempt: UpdateAttempt = { phase: 'saving', reloadRequested: false };
    updateAttempt.current = attempt;
    setUpdating(true);
    console.log('[SW] User confirmed update, reloading');
    setShowUpdatePrompt(false);
    void activateUpdate(updateServiceWorker, attempt).catch(error => {
      pauseUpdate(attempt, String(error));
    });
  }, [updateServiceWorker, activateUpdate, pauseUpdate]);

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
    updating,
  };
}

export const useServiceWorker = __RELEASE_ID__ ? useReleaseUpdates : useLegacyServiceWorker;
