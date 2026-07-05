import { Info, X } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

/**
 * Slim, dismissible strip shown when this browser can't durably keep the user's
 * documents — either storage is blocked (Recents won't persist) or it's
 * best-effort (the browser may clear it). The honest counterpart to the
 * local-only persistence model. One-time: the dismissal is persisted.
 */
export function StorageNotice() {
  const storageHealth = useUIStore((s) => s.storageHealth);
  const dismissedLevel = useUIStore((s) => s.storageNoticeDismissed);
  const dismiss = useUIStore((s) => s.dismissStorageNotice);

  // Suppress only when the user dismissed THIS health level; a later, more
  // serious level (evictable -> unavailable) still surfaces.
  if (storageHealth === 'ok' || storageHealth === dismissedLevel) return null;

  const message =
    storageHealth === 'unavailable'
      ? "This browser is blocking storage, so your document list (Recents) won't be saved between visits."
      : storageHealth === 'unreadable'
        ? "Your saved documents couldn't be read this visit — nothing was deleted."
        : 'Your documents are saved in this browser only and could be cleared by it.';
  const suffix =
    storageHealth === 'unreadable'
      ? 'Reloading usually fixes it; if not, restore from a backup file.'
      : 'Use Download or Share to keep a permanent copy.';

  // A blocked/unreadable store is a data-durability problem, so announce it
  // assertively; the benign "best-effort" heads-up stays polite.
  const role = storageHealth === 'unavailable' || storageHealth === 'unreadable' ? 'alert' : 'status';

  return (
    <div
      role={role}
      className="flex items-start gap-2 border-b border-b-warning/30 border-l-2 border-l-warning bg-warning/10 px-4 py-1 text-xs text-foreground"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1">
        {message} <span className="text-muted-foreground">{suffix}</span>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss storage notice"
        className="-m-1.5 shrink-0 rounded p-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
