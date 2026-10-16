import { useState } from 'react';
import { X } from 'lucide-react';

const DISMISSED_KEY = 'dondocs-banner-dismissed';

/** Keep the original notice and its saved dismissal across workspace views. */
export function BetaBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === 'true'; }
    catch { return false; }
  });

  if (dismissed) return null;

  return <aside aria-label="Unofficial website notice" className="flex shrink-0 items-center gap-2 border-b border-warning/20 bg-warning/10 px-3 py-1 text-xs text-warning">
    <p className="flex-1 text-center leading-relaxed">
      <span className="font-medium">Not an official DoW website.</span>{' '}
      Beta release — report issues on{' '}
      <a href="https://github.com/marinecoders/dondocs/issues" target="_blank" rel="noopener noreferrer" className="rounded-sm underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">GitHub</a>.
    </p>
    <button type="button" aria-label="Dismiss unofficial website banner"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-warning/15 focus-visible:outline-2 focus-visible:outline-ring sm:h-7 sm:w-7"
      onClick={() => {
        setDismissed(true);
        try { localStorage.setItem(DISMISSED_KEY, 'true'); }
        catch { /* Dismiss for this session when browser storage is unavailable. */ }
      }}>
      <X className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  </aside>;
}
