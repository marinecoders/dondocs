import { Info, X } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';

/**
 * Slim, dismissible strip shown when this browser can't durably keep the user's
 * documents — either storage is blocked (Recents won't persist) or it's
 * best-effort (the browser may clear it). The honest counterpart to the
 * local-only persistence model. One-time: the dismissal is persisted.
 */
export function StorageNotice({ placement = 'all' }: { placement?: 'all' | 'header' | 'footer' }) {
  const storageHealth = useUIStore((s) => s.storageHealth);
  const dismissedLevel = useUIStore((s) => s.storageNoticeDismissed);
  const dismiss = useUIStore((s) => s.dismissStorageNotice);

  if (placement === 'header' && storageHealth === 'evictable') return null;
  if (placement === 'footer' && storageHealth !== 'evictable') return null;

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
      : 'Keep an external backup or downloaded copy.';

  // A blocked/unreadable store is a data-durability problem, so announce it
  // assertively; the benign "best-effort" heads-up stays polite.
  const role = storageHealth === 'unavailable' || storageHealth === 'unreadable' ? 'alert' : 'status';

  return (
    <div
      role={role}
      className={`flex shrink-0 items-start gap-2 px-4 sm:px-6 py-2 text-xs ${placement === 'footer' ? 'border-t border-border text-muted-foreground' : 'border-b border-warning/30 bg-warning/10 text-foreground'}`}
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1">
        {message} <span className="text-muted-foreground">{suffix}</span>{' '}
        <button type="button" className="inline-flex min-h-6 items-center rounded underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => useUIStore.getState().setSettingsOpen(true, 'backup')}>Backup options</button>
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
