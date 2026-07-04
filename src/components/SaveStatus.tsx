import { useEffect, useReducer } from 'react';
import { Check, Loader2, AlertCircle, FolderSync } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useBackupStore } from '@/stores/backupStore';

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
 * Failure states are deliberately NOT rendered here (BackupNotice owns them);
 * this indicator only ever affirms what is true.
 */
export function SaveStatus({ className }: { className?: string }) {
  const lastSavedAt = useUIStore((s) => s.lastSavedAt);
  const saveStatus = useUIStore((s) => s.saveStatus);
  const backupStatus = useBackupStore((s) => s.status);
  const lastBackupAt = useBackupStore((s) => s.lastBackupAt);
  const backupFileName = useBackupStore((s) => s.fileName);
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
  // this session — never on 'error'/'needs-permission' (BackupNotice's job).
  const backedUp = backupStatus === 'connected' && lastBackupAt != null;
  return (
    <span className={`inline-flex items-center gap-1 ${base}`}>
      <Check className="h-3 w-3 text-[var(--success)]" aria-hidden />
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
    </span>
  );
}
