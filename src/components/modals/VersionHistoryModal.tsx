import { useEffect, useId, useRef, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/uiStore';
import { SessionChanges } from '@/components/SessionChanges';
import { getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore, deriveTitle } from '@/stores/documentsStore';
import { idbReadSnapshots, type DocSnapshot } from '@/lib/documentsDb';

function fmt(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

/** Inspection never saves a checkpoint. Restoration saves a safety copy first. */
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
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const versionSelectId = useId();
  const comparisonRef = useRef<HTMLDivElement>(null);
  const [currentSession] = useState(getSerializedSession);
  const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [readAttempt, setReadAttempt] = useState(0);

  useEffect(() => {
    if (comparisonRef.current) comparisonRef.current.scrollTop = 0;
  }, [selected]);

  useEffect(() => {
    let alive = true;
    void idbReadSnapshots(docId).then((s) => {
      if (alive) { setSnaps(s); setReadState('ready'); }
    }).catch(() => {
      if (alive) setReadState('error');
    });
    return () => { alive = false; };
  }, [docId, readAttempt]);

  function selectVersion(snapshot: DocSnapshot) {
    setSelected(snapshot);
    setRestoreError(null);
  }

  async function restoreSelected() {
    if (!selected || restoring) return;
    if (useDocumentsStore.getState().currentId !== docId) {
      setRestoreError('The active document changed. Close History and reopen it for the document you want to restore.');
      return;
    }
    setRestoring(true);
    setRestoreError(null);
    try {
      const ok = await restoreSnapshot(selected.session);
      if (ok) setDocId(null);
      else setRestoreError("Couldn't save a safety copy of the current draft, so nothing was restored. Try again — or copy any unsaved work first.");
    } catch {
      setRestoreError('Couldn’t finish restoring this version. Check your current document before trying again.');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !restoring) setDocId(null); }}>
      <DialogContent className="sm:max-w-5xl h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] sm:h-[min(44rem,85dvh)] sm:max-h-[85dvh] flex flex-col gap-3 p-4 sm:gap-4 sm:p-6 overflow-hidden">
        <DialogHeader className="shrink-0 pr-10 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Version history
          </DialogTitle>
        </DialogHeader>
        {restoreError && (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {restoreError}
          </p>
        )}
        <div className="min-h-0 flex-1 flex flex-col gap-4 md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
          <div role="region" aria-label="Saved versions" className="min-h-0 shrink-0 max-h-36 overflow-y-auto rounded-md md:max-h-none">
            {readState === 'loading' ? (
              <p role="status" className="py-6 text-center text-sm text-muted-foreground">Loading saved versions…</p>
            ) : readState === 'error' ? (
              <div className="space-y-3 py-4">
                <p role="alert" className="text-sm">Couldn’t load saved versions. Try again. Your current document hasn’t changed.</p>
                <Button variant="outline" onClick={() => { setReadState('loading'); setReadAttempt((attempt) => attempt + 1); }}>Retry</Button>
              </div>
            ) : snaps.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No saved versions yet. Versions are captured automatically as you keep editing and each time you Save checkpoint.
              </p>
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  <label htmlFor={versionSelectId} className="text-xs text-muted-foreground">Saved version</label>
                  <select
                    id={versionSelectId}
                    className="h-11 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                    value={selected ? snaps.indexOf(selected) : ''}
                    disabled={restoring}
                    onChange={event => selectVersion(snaps[Number(event.target.value)])}
                  >
                    <option value="" disabled>Select a version to compare</option>
                    {snaps.map((snap, i) => <option key={`${snap.ts}-${i}`} value={i}>{fmt(snap.ts)}{i === 0 ? ' · latest' : ''}</option>)}
                  </select>
                </div>
                <ul className="hidden space-y-1 md:block">
                  {snaps.map((snap, i) => (
                    <li key={`${snap.ts}-${i}`}>
                      <button
                        type="button"
                        aria-label={`Compare version ${i + 1} from ${fmt(snap.ts)}`}
                        aria-pressed={selected === snap}
                        disabled={restoring}
                        onClick={() => selectVersion(snap)}
                        className="min-h-11 w-full rounded-md border border-transparent px-3 py-2 text-left hover:bg-muted aria-pressed:border-border aria-pressed:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                      >
                        <span className="block text-xs text-muted-foreground tnum">{fmt(snap.ts)}{i === 0 ? ' · latest' : ''}</span>
                        <span className="mt-1 block [overflow-wrap:anywhere] text-sm line-clamp-2" title={deriveTitle(snap.session)}>{deriveTitle(snap.session)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div ref={comparisonRef} role="region" aria-label="Version comparison" tabIndex={0} className="min-h-0 min-w-0 flex-1 overflow-y-auto border-t pt-4 pr-1 focus-visible:outline-2 focus-visible:outline-ring md:border-t-0 md:border-l md:pt-0 md:pl-5">
            {selected ? <div className="space-y-4">
              <h2 className="hidden text-sm font-medium md:block">Changes from {fmt(selected.ts)}</h2>
              <SessionChanges before={currentSession} after={selected.session} highlightText />
            </div> : <p className="py-6 text-sm text-muted-foreground">Select a saved version to inspect its changes. Your current document stays unchanged until you restore.</p>}
          </div>
        </div>
        {selected && <DialogFooter className="shrink-0 border-t pt-4 sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground sm:max-w-sm">Restoring saves a safety version of your current work first.</p>
          <Button disabled={restoring} onClick={restoreSelected}>
            <RotateCcw className="mr-2 h-4 w-4" />{restoring ? 'Saving safety version…' : 'Restore selected version'}
          </Button>
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
