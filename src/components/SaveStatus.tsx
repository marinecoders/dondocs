import { useEffect, useReducer } from 'react';
import { Check, Loader2, AlertCircle, FolderSync, HardDrive } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useBackupStore, type BackupStatus } from '@/stores/backupStore';

function savedAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/**
 * Passive "Saved · <time>" indicator reflecting the real last persist (the
 * registry write for correspondence, formStore's persist for forms). Renders
 * nothing until the first save. Replaces the old manual-save toast theater so
 * the UI honestly shows that work is being kept automatically.
 *
 * When the synced auto-backup is connected AND has actually written, a
 * second "Backed up" segment appears — the durable confidence signal that the
 * account is mirrored to a file outside the browser, not just to its storage.
 *
 * With no working backup it says so instead: "Local only". That is the state
 * most people are in, and it is the one that cost a user their library when an
 * enterprise Windows update wiped the browser profile — the banners that were
 * supposed to warn about it never fire, because `persisted()` returns true and
 * `beforeinstallprompt` says nothing about durability. A standing word next to
 * the save time is honest on every browser, can't be dismissed into nothing,
 * and never interrupts. Where a backup can actually be set up it is the button
 * that does it; where it can't (no File System Access API) it stays plain text
 * and the tooltip points at the manual export instead of a dead end.
 *
 * Diagnosis stays out of here: a broken backup says "Local only" like any other
 * unbacked state and leaves the explaining to BackupNotice. It still carries
 * that strip's repair, because the strip can be dismissed and this can't.
 */
export function SaveStatus({ className }: { className?: string }) {
  const lastSavedAt = useUIStore((s) => s.lastSavedAt);
  const saveStatus = useUIStore((s) => s.saveStatus);
  const backupStatus = useBackupStore((s) => s.status);
  const lastBackupAt = useBackupStore((s) => s.lastBackupAt);
  const backupFileName = useBackupStore((s) => s.fileName);
  const setupBackup = useBackupStore((s) => s.setupBackup);
  const reconnect = useBackupStore((s) => s.reconnect);
  const [, refresh] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (lastSavedAt == null) return;
    const id = window.setInterval(refresh, 30_000); // keep the relative time fresh
    return () => window.clearInterval(id);
  }, [lastSavedAt]);

  const base = className ?? 'text-xs text-muted-foreground';

  if (saveStatus === 'saving') {
    return (
      <span className={`inline-flex items-center gap-1 ${base}`} aria-live="polite">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        Saving…
      </span>
    );
  }
  if (saveStatus === 'error') {
    return (
      <span
        className={`inline-flex items-center gap-1 ${className ?? 'text-xs'} text-destructive`}
        role="status"
        title="The document couldn't be written to this browser's storage. Use Download or Share to keep a copy."
      >
        <AlertCircle className="h-3 w-3" aria-hidden />
        Couldn&apos;t save
      </span>
    );
  }
  if (lastSavedAt == null) return null;
  // Affirm the mirror only when it is live and has committed at least once
  // this session.
  const backedUp = backupStatus === 'connected' && lastBackupAt != null;
  // Connected but not yet written is transient (the next save mirrors), so it
  // claims neither — saying "Local only" there would be alarming and wrong.
  const localOnly = backupStatus !== 'connected';
  // Wherever a backup can still be arranged, the chip is the control that does
  // it. BackupNotice offers the same two actions but is dismissible, so the way
  // out can't depend on that strip being on screen. Only 'unsupported' has no
  // action — offering one there would be a dead end.
  const fix = backupFix(backupStatus, { setupBackup, reconnect });
  return (
    <span className={`inline-flex items-center gap-1 tnum ${base}`}>
      <Check className="h-3 w-3 text-success" aria-hidden />
      Saved · {savedAgo(lastSavedAt)}
      {backedUp && (
        <span
          className="inline-flex items-center gap-1"
          title={`Auto-backup is on — your account mirrors to ${backupFileName ?? 'your backup file'} after every save. Last backup ${savedAgo(lastBackupAt)}.`}
        >
          <span aria-hidden>·</span>
          <FolderSync className="h-3 w-3" aria-hidden />
          Backed up
        </span>
      )}
      {localOnly && (
        <>
          <span aria-hidden>·</span>
          {fix ? (
            <button
              type="button"
              onClick={() => void fix.run()}
              // Keeps the visible text as the start of the name, so voice
              // control still matches "click Local only".
              aria-label={`Local only — ${fix.label}`}
              title={localOnlyHint(backupStatus)}
              className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <HardDrive className="h-3 w-3" aria-hidden />
              Local only
            </button>
          ) : (
            <span className="inline-flex items-center gap-1" title={localOnlyHint(backupStatus)}>
              <HardDrive className="h-3 w-3" aria-hidden />
              Local only
            </span>
          )}
        </>
      )}
    </span>
  );
}

/** The repair the chip offers, or null where this browser has none. */
function backupFix(
  status: BackupStatus,
  actions: { setupBackup: () => Promise<void>; reconnect: () => Promise<void> },
): { run: () => Promise<void>; label: string } | null {
  // Same mapping BackupNotice uses: a dropped permission is re-granted on the
  // file we already have; a write failure needs a different file.
  if (status === 'needs-permission') return { run: actions.reconnect, label: 'reconnect auto-backup' };
  if (status === 'error') return { run: actions.setupBackup, label: 'choose a new backup file' };
  if (status === 'off') return { run: actions.setupBackup, label: 'set up auto-backup' };
  return null; // 'unsupported'
}

/** Why "Local only" is showing, and the way out that this browser actually has. */
function localOnlyHint(status: BackupStatus): string {
  const where = 'Your documents are saved in this browser only.';
  if (status === 'unsupported') {
    return `${where} This browser can't keep an auto-backup file — use Download or Back up everything to keep a permanent copy.`;
  }
  if (status === 'needs-permission') {
    return `${where} Auto-backup is paused until you re-grant access to its file.`;
  }
  if (status === 'error') {
    return `${where} Auto-backup can't write to its file — pick a new one.`;
  }
  return `${where} Set up auto-backup to mirror them to a file outside it.`;
}
