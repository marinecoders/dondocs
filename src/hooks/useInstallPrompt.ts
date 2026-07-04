import { useEffect } from 'react';
import { useInstallStore, type BeforeInstallPromptEvent } from '@/stores/installStore';
import { getDeviceInfo } from '@/utils/device';
import { debug } from '@/lib/debug';

/**
 * Owns the install-to-device listeners; mount ONCE in App (next to
 * useServiceWorker). Captures Chromium's `beforeinstallprompt` (with
 * preventDefault, which also suppresses Chrome's own mini-infobar so the app
 * controls when to ask), tracks `appinstalled`, and seeds the installed state
 * from the display mode.
 *
 * IMPORTANT: `beforeinstallprompt` fires far less than expected — never on
 * Safari/iOS/Firefox and often not on locked-down enterprise Chrome/Edge
 * (NMCI!). `canInstall` is false more often than true, so install UI must
 * never render a dead button: promptInstall() falls back to the instructions
 * modal whenever there is no captured prompt.
 *
 * Every API here is a local browser API — no network, air-gap safe.
 */

/** Running as an installed app right now (Chromium standalone / iOS standalone). */
export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari's pre-standard flag for Add-to-Home-Screen apps.
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export function useInstallPrompt(): void {
  useEffect(() => {
    const store = useInstallStore.getState();
    store.setInstalled(isStandalone());

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      useInstallStore.getState().setDeferredPrompt(e as BeforeInstallPromptEvent);
      debug.log('Install', 'beforeinstallprompt captured');
    };
    const onAppInstalled = () => {
      useInstallStore.getState().setInstalled(true);
      debug.log('Install', 'appinstalled');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);
}

/**
 * The one entry point every install control calls. With a captured prompt →
 * fire the native install dialog (single-use; cleared afterwards either way).
 * Without one (iOS, Firefox, enterprise policy, already dismissed by the
 * browser) → open the device-branched instructions modal instead.
 */
export async function promptInstall(): Promise<void> {
  const { deferredPrompt, setDeferredPrompt, setInstallModalOpen } = useInstallStore.getState();
  if (!deferredPrompt) {
    setInstallModalOpen(true);
    return;
  }
  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    debug.log('Install', 'native prompt outcome', choice);
  } catch (err) {
    // A consumed/stale event throws; fall back to instructions rather than dead-end.
    debug.error('Install', 'native prompt failed', err);
    useInstallStore.getState().setInstallModalOpen(true);
  } finally {
    // The event is single-use regardless of outcome.
    setDeferredPrompt(null);
  }
}

/** Whether any install affordance should show at all: hidden once installed,
 *  and on platforms with neither a prompt nor a manual path worth teaching. */
export function isInstallRelevant(canInstall: boolean, isInstalled: boolean): boolean {
  if (isInstalled) return false;
  if (canInstall) return true;
  const d = getDeviceInfo();
  // iOS always has the manual Add-to-Home-Screen path; other prompt-less
  // platforms (desktop Firefox…) have no PWA install story worth a banner.
  return d.isIOS;
}
