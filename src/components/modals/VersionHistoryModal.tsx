import { useEffect, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { idbGetSnapshots, type DocSnapshot } from '@/lib/documentsDb';

function fmt(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Version history for the current document. Lists the captured snapshots
 * (point-in-time copies taken as you keep editing and on explicit Save) and
 * lets you restore one — restoring snapshots the current state first, so it's
 * itself reversible.
 */
export function VersionHistoryModal() {
  const docId = useUIStore((s) => s.historyDocId);
  const setDocId = useUIStore((s) => s.setHistoryDocId);
  const restoreSnapshot = useDocumentsStore((s) => s.restoreSnapshot);
  const [snaps, setSnaps] = useState<DocSnapshot[]>([]);
  const [restoreFailed, setRestoreFailed] = useState(false);

  useEffect(() => {
    if (!docId) return;
    let alive = true;
    void idbGetSnapshots(docId).then((s) => {
      if (alive) setSnaps(s);
    });
    return () => {
      alive = false;
    };
  }, [docId]);

  return (
    <Dialog
      open={docId != null}
      onOpenChange={(o) => {
        if (!o) {
          setDocId(null);
          setRestoreFailed(false); // stale warning must not greet the next open
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Version history
          </DialogTitle>
        </DialogHeader>
        {restoreFailed && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Couldn&apos;t save a safety copy of the current draft, so nothing was restored. Try
            again — or copy any unsaved work first.
          </p>
        )}
        {snaps.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No saved versions yet. Versions are captured automatically as you keep editing and each
            time you Save.
          </p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {snaps.map((snap, i) => (
              <li
                key={snap.ts}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="min-w-0 text-sm">
                  <span className="block truncate text-foreground">
                    {snap.session.formData?.subject?.trim() || 'Untitled version'}
                  </span>
                  <span className="block text-[11px] text-muted-foreground tnum">
                    {fmt(snap.ts)}
                    {i === 0 ? ' · latest' : ''}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    // restoreSnapshot only proceeds once the safety copy of the
                    // current draft has committed — if it can't, nothing was
                    // restored, so keep the modal open and say why.
                    if (await restoreSnapshot(snap.session)) {
                      setDocId(null);
                    } else {
                      setRestoreFailed(true);
                    }
                  }}
                >
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
