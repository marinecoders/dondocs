import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { TourButton } from '@/components/tour/TourButton';
import { useTourStore, hasCompletedTour } from '@/stores/tourStore';
import { useUIStore } from '@/stores/uiStore';
import { getDeviceInfo } from '@/utils/device';
// Script face for the "Marine Coders" sign-off. Self-hosted via @fontsource
// (same-origin, no web-font CDN) to stay air-gap safe.
import '@fontsource/damion/400.css';

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
// Set the first time the letter opens on its own. Earlier releases wrote it
// only on "don't show again", so any value means this browser has seen it.
const WELCOME_SEEN_KEY = 'dondocs-welcome-shown';

export function WelcomeModal() {
  const open = useUIStore((state) => state.welcomeOpen);
  const setOpen = useUIStore((state) => state.setWelcomeOpen);

  const finish = (startTour: boolean) => {
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
            className="rounded-[3px] px-6 py-6 sm:px-8 shadow-xl"
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
                  typeset. Document processing runs in your browser. Your workspace is stored on this
                  device; you choose when to export, back up, or share a document.
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
  useUIStore.getState().setWelcomeOpen(true);
}

/**
 * Greet a first-time visitor. App calls this only on a fresh start that didn't
 * arrive through a share or companion link, so a recipient opening a document
 * goes straight to it. The letter opens once per browser: someone who never
 * saves a document still starts fresh next visit, and shouldn't be greeted again.
 */
export function showWelcomeOnFirstVisit() {
  // In-app browsers get the browser-compatibility notice instead.
  if (getDeviceInfo().isInAppBrowser) return;
  try {
    if (localStorage.getItem(WELCOME_SEEN_KEY)) return;
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
  } catch {
    // Blocked storage can't remember the letter was shown, so skip it rather
    // than open it on every visit. Help still has it.
    return;
  }
  useUIStore.getState().setWelcomeOpen(true);
}
