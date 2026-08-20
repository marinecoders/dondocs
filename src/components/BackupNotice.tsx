import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { backupAction, useBackupStore, type BackupStatus } from '@/stores/backupStore';

/** What each repair says. The choice of which is made in the store. */
const NOTICE_COPY = {
  reconnect: {
    message: 'Auto-backup is paused — reconnect to keep your synced backup current.',
    actionLabel: 'Reconnect',
  },
  setup: {
    message: "Auto-backup can't find your backup file — it may have been moved or deleted.",
    actionLabel: 'Choose file',
  },
  // Naming the usual culprit beats a retry button on its own: on Windows this is
  // nearly always ransomware protection standing between the browser and that
  // folder, which no amount of retrying fixes.
  retry: {
    message:
      "Auto-backup couldn't write to your file. If this keeps happening, ransomware protection may be blocking your browser from that folder.",
    actionLabel: 'Try again',
  },
} as const;

/**
 * Slim, dismissible strip shown when the synced backup file has stopped
 * updating — either the browser dropped write permission on restart
 * ('needs-permission', which happens on EVERY relaunch by design: browsers
 * revoke file-write grants when the app fully closes and require a fresh user
 * gesture) or a write failed ('error', whether because the file is gone or
 * because something refused the write). The status otherwise lived only inside
 * the Save menu, so a returning user had no way to know their backup had
 * quietly paused. One click here re-arms it.
 */
export function BackupNotice() {
  const status = useBackupStore((s) => s.status);
  const fileName = useBackupStore((s) => s.fileName);
  const reconnect = useBackupStore((s) => s.reconnect);
  const setupBackup = useBackupStore((s) => s.setupBackup);
  const writeNow = useBackupStore((s) => s.writeNow);
  const fileMissing = useBackupStore((s) => s.fileMissing);
  // Per-status dismissal: hiding the "needs-permission" strip shouldn't also
  // suppress a later, different "error" — mirrors StorageNotice's per-level rule.
  const [dismissedStatus, setDismissedStatus] = useState<BackupStatus | null>(null);

  const action = backupAction(status, fileMissing);
  // 'off' has an action — set one up — but no business interrupting anyone.
  if (!action || status === 'off' || status === dismissedStatus) return null;

  const { message, actionLabel } = NOTICE_COPY[action];
  const onAction = { reconnect, setup: setupBackup, retry: writeNow }[action];

  // A failed write means the backup is silently stale — announce it assertively;
  // a permission drop on relaunch is expected and stays polite.
  const role = status === 'error' ? 'alert' : 'status';

  return (
    <div
      role={role}
      className="flex items-start gap-2 border-b border-b-warning/30 border-l-2 border-l-warning bg-warning/10 px-4 py-1 text-xs text-foreground"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1">
        {message}
        {fileName ? <span className="text-muted-foreground"> ({fileName})</span> : null}
      </p>
      <button
        type="button"
        onClick={() => void onAction()}
        className="-my-1.5 shrink-0 rounded px-2 py-1.5 font-medium text-warning underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {actionLabel}
      </button>
      <button
        type="button"
        onClick={() => setDismissedStatus(status)}
        aria-label="Dismiss backup notice"
        className="-m-1.5 shrink-0 rounded p-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
