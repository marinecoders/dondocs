import { useState, useEffect } from 'react';
import { getDeviceInfo } from '@/utils/device';
import { hasSavedSession } from '@/stores/documentStore';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const WELCOME_STORAGE_KEY = 'dondocs-welcome-shown';
// Tracks the version of the WELCOME MODAL CONTENT — not the app version.
// Bump this when the welcome modal's copy/design changes meaningfully so
// returning users see the updated content once. This is intentionally
// separate from APP_VERSION in @/lib/version (which tracks code releases).
const WELCOME_CONTENT_VERSION = '3.0';

// The Marine Coders seal (angle brackets around the Eagle, Globe, and
// Anchor). Same asset the app uses as its background watermark, so the
// welcome and the app behind it carry one mark. White artwork on a
// transparent ground — `brightness(0)` renders it as black ink on the
// cream "paper" of the letter.
const SEAL_SRC = `${import.meta.env.BASE_URL}attachments/marine-coders-logo.svg`;

// Cream paper + dark ink — a self-contained skeuomorphic surface, so its
// colors live here rather than in the app theme tokens.
const PAPER_BG = '#faf8f2';
const INK = '#1d2128';
const INK_MUTED = '#3a3f48';
const SERIF = 'Georgia, "Times New Roman", serif';

export function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    // Don't show welcome modal on incompatible browsers - they get the browser notice instead
    const device = getDeviceInfo();
    if (device.isInAppBrowser) {
      console.log('[WelcomeModal] Skipping - in-app browser detected');
      return;
    }

    // Don't show welcome modal if there's a saved session to restore
    // Returning users have already seen the welcome
    if (hasSavedSession()) {
      console.log('[WelcomeModal] Skipping - saved session exists');
      return;
    }

    // Read localStorage on mount to decide whether to show the welcome
    // modal. Cannot be derived during render -- localStorage is an
    // external system, and the value can change between sessions.
    // Legitimate "synchronize React state with external system" pattern.
    const stored = localStorage.getItem(WELCOME_STORAGE_KEY);
    if (!stored || stored !== WELCOME_CONTENT_VERSION) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem(WELCOME_STORAGE_KEY, WELCOME_CONTENT_VERSION);
    }
    setOpen(false);
  };

  // Today's date in naval format (e.g. "12 Jun 2026"), so the letter reads
  // as freshly drafted for this reader rather than a static template.
  const today = new Date().toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="sm:max-w-lg p-0 gap-0 overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
        showCloseButton={false}
      >
        {/* The visual title is the letter's Subj line; this keeps the
            dialog accessible without a duplicate visible heading. */}
        <DialogTitle className="sr-only">Welcome aboard DonDocs</DialogTitle>

        {/* The welcome message, drafted as a naval letter on cream paper. */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 pb-0">
          <div
            className="relative rounded-[3px] px-6 py-6 sm:px-8 shadow-[0_12px_34px_rgba(0,0,0,0.55)]"
            style={{ backgroundColor: PAPER_BG, color: INK, fontFamily: SERIF }}
          >
            {/* Embossed seal, pressed faintly into the page behind the text. */}
            <img
              src={SEAL_SRC}
              alt=""
              aria-hidden="true"
              className="pointer-events-none select-none absolute"
              style={{ right: '18px', bottom: '14px', width: '132px', opacity: 0.05, filter: 'brightness(0)', zIndex: 0 }}
            />

            <div className="relative" style={{ zIndex: 1 }}>
              {/* Letterhead */}
              <div className="text-center mb-3.5">
                <img
                  src={SEAL_SRC}
                  alt="Marine Coders"
                  className="mx-auto mb-2"
                  style={{ height: '42px', filter: 'brightness(0)' }}
                />
                <div style={{ fontSize: '11px', letterSpacing: '0.18em', color: INK }}>
                  MARINE CODERS
                </div>
                <div style={{ borderTop: `1.5px solid ${INK}`, marginTop: '8px' }} />
                <div style={{ borderTop: `0.5px solid ${INK}`, marginTop: '2px' }} />
              </div>

              <p className="text-right" style={{ fontSize: '12px', color: INK_MUTED, margin: '0 0 14px' }}>
                {today}
              </p>

              <div style={{ fontSize: '13px', lineHeight: 1.5 }}>
                <div className="flex">
                  <span className="font-bold" style={{ width: '46px', flexShrink: 0 }}>From:</span>
                  <span>Marine Coders</span>
                </div>
                <div className="flex">
                  <span className="font-bold" style={{ width: '46px', flexShrink: 0 }}>To:</span>
                  <span>New User</span>
                </div>
                <div className="flex" style={{ marginBottom: '12px' }}>
                  <span className="font-bold" style={{ width: '46px', flexShrink: 0 }}>Subj:</span>
                  <span className="font-bold" style={{ letterSpacing: '0.02em' }}>WELCOME ABOARD DONDOCS</span>
                </div>

                <div className="flex" style={{ marginBottom: '10px' }}>
                  <span style={{ width: '20px', flexShrink: 0 }}>1.</span>
                  <span>
                    DonDocs drafts SECNAV M-5216.5&ndash;compliant naval correspondence &mdash; twenty
                    formats, properly typeset &mdash; entirely in your browser. No servers, no uploads;
                    nothing leaves your device.
                  </span>
                </div>
                <div className="flex">
                  <span style={{ width: '20px', flexShrink: 0 }}>2.</span>
                  <span>
                    Begin your first letter below. <em>Semper Fidelis.</em>
                  </span>
                </div>
              </div>

              {/* Signature block */}
              <div className="text-right" style={{ marginTop: '20px' }}>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontStyle: 'italic',
                    fontSize: '23px',
                    lineHeight: 1,
                    color: '#1a2740',
                  }}
                >
                  Marine Coders
                </div>
                <div style={{ fontSize: '11px', letterSpacing: '0.08em', color: INK_MUTED, marginTop: '4px' }}>
                  MARINE CODERS &middot; marinecoders.org
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls live in the dark chrome below the letter, keeping the
            page itself pristine. */}
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
          <Button onClick={handleClose}>Start a letter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Export helper to reset welcome modal (for settings/help menu)
export function resetWelcomeModal() {
  localStorage.removeItem(WELCOME_STORAGE_KEY);
}
