import { useEffect, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { SessionChanges } from '@/components/SessionChanges';
import { getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore, deriveTitle } from '@/stores/documentsStore';
import { idbReadSnapshots, type DocSnapshot } from '@/lib/documentsDb';

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
  return docId ? <DocumentHistory key={docId} docId={docId} /> : null;
}

function DocumentHistory({ docId }: { docId: string }) {
  const setDocId = useUIStore((s) => s.setHistoryDocId);
  const restoreSnapshot = useDocumentsStore((s) => s.restoreSnapshot);
  const [snaps, setSnaps] = useState<DocSnapshot[]>([]);
  const [selected, setSelected] = useState<DocSnapshot | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);

  const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [readAttempt, setReadAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    void idbReadSnapshots(docId).then((s) => {
      if (alive) { setSnaps(s); setReadState('ready'); }
    }).catch(() => {
      if (alive) setReadState('error');
    });
    return () => {
      alive = false;
    };
  }, [docId, readAttempt]);

  return (
    <Dialog
      open={docId != null}
      onOpenChange={(o) => {
        if (!o && !restoring) {
          setSelected(null);
          setDocId(null);
          setRestoreFailed(false); // stale warning must not greet the next open
        }
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
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
        {readState === 'loading' ? (
          <p role="status" className="py-6 text-center text-sm text-muted-foreground">Loading saved versions…</p>
        ) : readState === 'error' ? (
          <div className="space-y-3 py-4">
            <p role="alert" className="text-sm">Couldn’t load saved versions. Try again. Your current document hasn’t changed.</p>
            <Button variant="outline" onClick={() => { setReadState('loading'); setReadAttempt((attempt) => attempt + 1); }}>Retry</Button>
          </div>
        ) : snaps.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No saved versions yet. Versions are captured automatically as you keep editing and each
            time you Save checkpoint.
          </p>
        ) : (
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            {snaps.map((snap, i) => (
              <li
                key={`${snap.ts}-${i}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="min-w-0 text-sm">
                  <span className="block truncate text-foreground">
                    {deriveTitle(snap.session)}
                  </span>
                  <span className="block text-2xs text-muted-foreground tnum">
                    {fmt(snap.ts)}
                    {i === 0 ? ' · latest' : ''}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={restoring}
                  onClick={() => setSelected(snap)}
                >
                  Compare
                </Button>
              </li>
            ))}
          </ul>
        )}
        {selected && <div className="space-y-4 border-t border-border pt-4">
          <p className="text-sm">Restoring creates a safety version first, so you can return to your current work.</p>
          <SessionChanges before={getSerializedSession()} after={selected.session} />
          <Button disabled={restoring} onClick={async () => {
            if (useDocumentsStore.getState().currentId !== docId) { setRestoreFailed(true); return; }
            setRestoring(true);
            const ok = await restoreSnapshot(selected.session);
            setRestoring(false);
            if (ok) { setDocId(null); setSelected(null); } else setRestoreFailed(true);
          }}><RotateCcw className="mr-2 h-4 w-4" />{restoring ? 'Saving safety version…' : 'Restore selected version'}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
