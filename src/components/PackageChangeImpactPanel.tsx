import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { PackageChangeImpactSummary } from './PackageChangeImpactSummary';
import { inspectPackageChangeImpact, type PackageChangeImpact, type PackageImpactDestination } from '@/lib/packageChangeImpact';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';

interface Props {
  record: ActionPackage;
  revision: PackageRevision;
  disabled: boolean;
  busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  isCurrent(): boolean;
  signal(): AbortSignal | undefined;
  onNavigate?(destination: PackageImpactDestination): void;
}
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
function defaultBaseline(record: ActionPackage, revision: PackageRevision): string {
  const index = record.revisions.findIndex(item => item.id === revision.id);
  return index > 0 ? record.revisions[index - 1].id : '';
}

/** Read-only inspection never appends a revision or changes a review's lifecycle. */
export function PackageChangeImpactPanel({ record, revision, disabled, busy, run, isCurrent, signal, onNavigate }: Props) {
  const heading = useId(), owner = `${record.id}:${record.sequence}:${revision.id}`;
  const [beforeId, setBeforeId] = useState(() => defaultBaseline(record, revision));
  const [report, setReport] = useState<PackageChangeImpact | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const ownerRef = useRef(owner), previousOwner = useRef(owner), mounted = useRef(false), generation = useRef(0), running = useRef(false);
  useLayoutEffect(() => { ownerRef.current = owner; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    if (previousOwner.current === owner) return;
    previousOwner.current = owner; generation.current++; setBeforeId(defaultBaseline(record, revision)); setReport(null); setError('');
  }, [owner, record, revision]);
  const index = record.revisions.findIndex(item => item.id === revision.id), candidates = index < 1 ? [] : record.revisions.slice(0, index);
  const locked = disabled || busy || pending;
  return <section aria-labelledby={heading} aria-busy={pending} className="min-w-0 space-y-3 rounded-lg border bg-background p-3 sm:p-4">
    <h3 id={heading} className="font-medium">Package change impact</h3>
    <p className="text-sm text-muted-foreground">Compare the selected revision with an earlier saved revision. See affected documents, requirements, references, retained PDFs and recorded reviews.</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {!candidates.length ? <p className="text-sm">No earlier saved revision is available in this package. Save another revision to compare changes.</p> : <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-sm">Comparison baseline<select aria-label="Change impact baseline" className="mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm" disabled={locked} value={beforeId}
        onChange={event => { generation.current++; setBeforeId(event.target.value); setReport(null); setError(''); }}>
        {candidates.map((item, ordinal) => <option key={item.id} value={item.id}>Saved revision {ordinal + 1}{item.id === revision.parentId ? ' · preceding revision' : ''}</option>)}
      </select></label>
      <Button className={buttonClass} variant="outline" disabled={locked || !beforeId} onClick={() => {
        if (running.current) return;
        running.current = true; setPending(true); setError('');
        const capturedOwner = owner, capturedGeneration = generation.current;
        void run(async () => {
          const capturedSignal = signal(), current = () => mounted.current && ownerRef.current === capturedOwner
            && generation.current === capturedGeneration && !capturedSignal?.aborted && isCurrent();
          try {
            const compared = await inspectPackageChangeImpact(record, beforeId, revision.id, capturedSignal);
            if (current()) setReport(compared);
          } catch (cause) { if (current()) { setReport(null); setError(cause instanceof Error ? cause.message : 'The package comparison failed.'); } }
        }).catch(cause => {
          if (mounted.current && ownerRef.current === capturedOwner && generation.current === capturedGeneration && isCurrent())
            setError(cause instanceof Error ? cause.message : 'The package comparison could not start.');
        }).finally(() => { running.current = false; if (mounted.current) setPending(false); });
      }}>Compare saved revisions</Button>
    </div>}
    {report && <PackageChangeImpactSummary impact={report} disabled={locked} onNavigate={onNavigate} />}
  </section>;
}
