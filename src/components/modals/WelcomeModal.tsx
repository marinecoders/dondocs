import { useState, useEffect } from 'react';
import { getDeviceInfo } from '@/utils/device';
import { hasSavedSession } from '@/stores/documentStore';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { TourButton } from '@/components/tour/TourButton';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useTourStore, hasCompletedTour } from '@/stores/tourStore';
import { useUIStore } from '@/stores/uiStore';
// Script face for the "Marine Coders" sign-off. Self-hosted via @fontsource
// (same-origin, no web-font CDN) to stay air-gap safe.
import '@fontsource/damion/400.css';

const WELCOME_STORAGE_KEY = 'dondocs-welcome-shown';
// Welcome-modal content version (not the app version). Bump it when the copy or
// design changes so returning users see the update once.
const WELCOME_CONTENT_VERSION = '3.0';

// Banner lockup (letter masthead) and seal (chop beside the signature). Both are
// light artwork on transparent, so brightness(0) renders them as black ink on the
// cream paper. The seal matches the app's background watermark.
const BANNER_SRC = `${import.meta.env.BASE_URL}attachments/marine-coders-banner.webp`;
const SEAL_SRC = `${import.meta.env.BASE_URL}attachments/marine-coders-logo.svg`;

// Cream paper + dark ink: a self-contained surface, so its colors live here
// rather than in the app theme tokens.
const PAPER_BG = '#faf8f2';
const INK = '#1d2128';
const INK_MUTED = '#3a3f48';
const SERIF = 'Georgia, "Times New Roman", serif';
const SIG_FONT = "'Damion', cursive";
// Fixed issue date: the welcome letter is dated once, not on every visit.
const ISSUE_DATE = '29 Dec 2025';

export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    // Incompatible browsers get the browser notice instead of the welcome.
    const device = getDeviceInfo();
    if (device.isInAppBrowser) {
      console.log('[WelcomeModal] Skipping - in-app browser detected');
      return;
    }

    // A saved session means a returning user who's already seen the welcome.
    if (hasSavedSession()) {
      console.log('[WelcomeModal] Skipping - saved session exists');
      return;
    }

    // Decide from localStorage whether to show the modal; it can't be derived
    // during render. Reading can throw under blocked site data — treat that as
    // "not yet seen" so a fresh user still gets the welcome and boot never crashes.
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(WELCOME_STORAGE_KEY);
    } catch {
      // blocked storage: leave stored=null so the welcome still shows
    }
    if (!stored || stored !== WELCOME_CONTENT_VERSION) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
      // New users land with the live preview open. Only runs for the welcome
      // cohort, so returning users keep their own preview preference.
      useUIStore.getState().setPreviewVisible(true);
    }
  }, []);

  const finish = (startTour: boolean) => {
    if (dontShowAgain) {
      try {
        localStorage.setItem(WELCOME_STORAGE_KEY, WELCOME_CONTENT_VERSION);
      } catch {
        /* blocked storage: the modal just reappears next visit */
      }
    }
    setOpen(false);
    // The tour is now opt-in: only launch it when the user explicitly asks, so a
    // new user isn't force-marched through a 7-step overlay before they can type.
    // It stays one click away from the Help menu and the getting-started checklist.
    if (startTour && !hasCompletedTour()) {
      setTimeout(() => useTourStore.getState().start(), 350);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-lg p-0 gap-0 overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
        showCloseButton={false}
      >
        {/* The visible title is the letter's Subj line; this sr-only heading
            keeps the dialog accessible without duplicating it. */}
        <DialogTitle className="sr-only">Welcome aboard DonDocs</DialogTitle>

        {/* The welcome message, drafted as a naval letter on cream paper. */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 pb-0">
          <div
            className="rounded-[3px] px-6 py-6 sm:px-8 shadow-[0_12px_34px_rgba(0,0,0,0.55)]"
            style={{ backgroundColor: PAPER_BG, color: INK, fontFamily: SERIF }}
          >
            {/* Letterhead: the wide Marine Coders lockup, engraved in black. */}
            <div className="mb-3">
              <img
                src={BANNER_SRC}
                alt="Marine Coders"
                className="mx-auto"
                decoding="sync"
                fetchPriority="high"
                style={{ height: '46px', filter: 'brightness(0)' }}
              />
              <div style={{ borderTop: `1px solid ${INK}`, marginTop: '12px' }} />
            </div>

            <p className="text-right" style={{ fontSize: '12px', color: INK_MUTED, margin: '0 0 14px' }}>
              {ISSUE_DATE}
            </p>

            <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
              <div className="flex">
                <span className="font-bold" style={{ width: '58px', flexShrink: 0 }}>From:</span>
                <span>Marine Coders</span>
              </div>
              <div className="flex">
                <span className="font-bold" style={{ width: '58px', flexShrink: 0 }}>To:</span>
                <span>New User</span>
              </div>
              <div className="flex" style={{ marginBottom: '12px' }}>
                <span className="font-bold" style={{ width: '58px', flexShrink: 0 }}>Subj:</span>
                <span className="font-bold" style={{ letterSpacing: '0.02em' }}>WELCOME ABOARD DONDOCS</span>
              </div>

              <div className="flex" style={{ marginBottom: '10px' }}>
                <span style={{ width: '20px', flexShrink: 0 }}>1.</span>
                <span>
                  DonDocs drafts Department of the Navy correspondence and forms to SECNAV M-5216.5
                  standard: naval letters, endorsements, memoranda, and NAVMC forms, all properly
                  typeset. Everything runs in your browser. No servers, no uploads, and nothing leaves
                  your device.
                </span>
              </div>
              <div className="flex" style={{ marginBottom: '10px' }}>
                <span style={{ width: '20px', flexShrink: 0 }}>2.</span>
                <span>
                  DonDocs is in open beta. Treat each draft as your own work and check every document
                  against the governing instruction before you sign or release it.
                </span>
              </div>
              <div className="flex">
                <span style={{ width: '20px', flexShrink: 0 }}>3.</span>
                <span>
                  Your feedback drives this tool. Send a bug or an idea from the Help menu and the next
                  version will be better for it. <em>Semper Fidelis.</em>
                </span>
              </div>
            </div>

            {/* Signature block: signed once, with the < EGA > seal as the chop. */}
            <div className="flex items-center justify-end gap-4" style={{ marginTop: '24px' }}>
              <div className="text-right">
                <div style={{ fontFamily: SIG_FONT, fontSize: '34px', lineHeight: 1, color: '#1a2740' }}>
                  Marine Coders
                </div>
                <div style={{ fontSize: '11px', letterSpacing: '0.06em', color: INK_MUTED, marginTop: '2px' }}>
                  marines.dev
                </div>
              </div>
              <img
                src={SEAL_SRC}
                alt=""
                aria-hidden="true"
                decoding="sync"
                fetchPriority="high"
                style={{ height: '52px', filter: 'brightness(0)', opacity: 0.9 }}
              />
            </div>
          </div>
        </div>

        {/* Controls live in the chrome below the letter. */}
        <DialogFooter className="px-4 sm:px-6 py-3 sm:py-4 shrink-0 sm:items-center">
          <div className="flex items-center gap-2 flex-1">
            <Checkbox
              id="dontShow"
              checked={dontShowAgain}
              onCheckedChange={(checked) => setDontShowAgain(!!checked)}
            />
            <Label htmlFor="dontShow" className="text-sm font-normal cursor-pointer">
              Don't show this again
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <TourButton variant="ghost" size="default" onClick={() => finish(true)}>
              Take a quick tour
            </TourButton>
            <TourButton size="default" arrow="next" onClick={() => finish(false)}>
              Start writing
            </TourButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Export helper to reset welcome modal (for settings/help menu)
export function resetWelcomeModal() {
  localStorage.removeItem(WELCOME_STORAGE_KEY);
}
