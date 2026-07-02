import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useBackupStore, type BackupStatus } from '@/stores/backupStore';

/**
 * Slim, dismissible strip shown when the synced backup file has stopped
 * updating — either the browser dropped write permission on restart
 * ('needs-permission', which happens on EVERY relaunch by design: browsers
 * revoke file-write grants when the app fully closes and require a fresh user
 * gesture) or a write failed ('error', e.g. the file was moved/deleted). The
 * status otherwise lived only inside the Save menu, so a returning user had no
 * way to know their backup had quietly paused. One click here re-arms it.
 */
export function BackupNotice() {
  const status = useBackupStore((s) => s.status);
  const fileName = useBackupStore((s) => s.fileName);
  const reconnect = useBackupStore((s) => s.reconnect);
  const setupBackup = useBackupStore((s) => s.setupBackup);
  // Per-status dismissal: hiding the "needs-permission" strip shouldn't also
  // suppress a later, different "error" — mirrors StorageNotice's per-level rule.
  const [dismissedStatus, setDismissedStatus] = useState<BackupStatus | null>(null);

  const degraded = status === 'needs-permission' || status === 'error';
  if (!degraded || status === dismissedStatus) return null;

  const needsPermission = status === 'needs-permission';
  const message = needsPermission
    ? 'Auto-backup is paused — reconnect to keep your synced backup current.'
    : "Auto-backup couldn't write to your file, so your backup may be out of date.";
  // A permission drop is fixed by re-granting; a write fault usually means the
  // file is gone/unwritable, so re-picking one is the honest recovery.
  const actionLabel = needsPermission ? 'Reconnect' : 'Choose file';
  const onAction = needsPermission ? reconnect : setupBackup;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-1 text-xs text-foreground"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="min-w-0 flex-1">
        {message}
        {fileName ? <span className="text-muted-foreground"> ({fileName})</span> : null}
      </p>
      <button
        type="button"
        onClick={() => void onAction()}
        className="shrink-0 rounded px-2 py-0.5 font-medium text-amber-700 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-amber-300"
      >
        {actionLabel}
      </button>
      <button
        type="button"
        onClick={() => setDismissedStatus(status)}
        aria-label="Dismiss backup notice"
        className="shrink-0 rounded p-0.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
