import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/compressedStorage';

/**
 * Install-to-device state. Chromium's `beforeinstallprompt` event is captured
 * here (useInstallPrompt owns the listeners) so an in-app "Install" control can
 * fire the native prompt on demand — the event is single-use, live-only, and
 * non-serializable, so it must NEVER enter storage. Only the banner snooze is
 * persisted.
 *
 * Everything here is a local browser API — no network, air-gap safe.
 */

/** Chromium's non-standard install event (not in lib.dom). */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

interface InstallState {
  /** Captured live event — cleared after use (it can only prompt once). */
  deferredPrompt: BeforeInstallPromptEvent | null;
  /** A captured prompt is available → the native install dialog can be shown. */
  canInstall: boolean;
  /** Running as an installed app (standalone display-mode / iOS standalone). */
  isInstalled: boolean;
  /** Passive banner snooze (epoch ms); persisted so a dismissal survives reloads. */
  dismissedUntil: number | null;
  /** The device-branched instructions modal (iOS / no-prompt fallback). */
  installModalOpen: boolean;
  setDeferredPrompt: (e: BeforeInstallPromptEvent | null) => void;
  setInstalled: (v: boolean) => void;
  snoozeBanner: (days?: number) => void;
  setInstallModalOpen: (open: boolean) => void;
}

export const useInstallStore = create<InstallState>()(
  persist(
    (set) => ({
      deferredPrompt: null,
      canInstall: false,
      isInstalled: false,
      dismissedUntil: null,
      installModalOpen: false,
      setDeferredPrompt: (e) => set({ deferredPrompt: e, canInstall: e !== null }),
      setInstalled: (v) =>
        set(v ? { isInstalled: true, deferredPrompt: null, canInstall: false } : { isInstalled: v }),
      snoozeBanner: (days = 14) => set({ dismissedUntil: Date.now() + days * 24 * 60 * 60 * 1000 }),
      setInstallModalOpen: (open) => set({ installModalOpen: open }),
    }),
    {
      name: 'dondocs-install',
      storage: createJSONStorage(() => safeLocalStorage),
      // ONLY the snooze — the live event object and derived flags must never persist.
      partialize: (s) => ({ dismissedUntil: s.dismissedUntil }),
    }
  )
);
