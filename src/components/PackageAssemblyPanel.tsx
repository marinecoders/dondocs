import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { defaultPackageAssemblySettings, type PackageAssemblySettings } from '@/lib/packageAssemblyModel';
import { updatePackageAssemblySettings } from '@/lib/packageAssemblySettings';
import { getExportDeploymentPolicy } from '@/config/classification';

interface Props {
  record: ActionPackage; revision: PackageRevision; disabled: boolean; busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  onApply(record: ActionPackage): void; onDirtyChange?(dirty: boolean): void;
  signal(): AbortSignal | undefined; isCurrent(): boolean;
}
export function PackageAssemblyPanel(props: Props) {
  return <AssemblySettings key={`${props.record.id}:${props.record.sequence}:${props.revision.id}`} {...props} />;
}
function AssemblySettings({ record, revision, disabled, busy, run, onApply, onDirtyChange, signal, isCurrent }: Props) {
  const heading = useId(), saved = revision.assembly ?? defaultPackageAssemblySettings();
  const [draft, setDraft] = useState<PackageAssemblySettings>(() => structuredClone(saved)), [reviewed, setReviewed] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const mounted = useRef(false), dirtyRef = useRef(onDirtyChange), running = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const editable = !disabled && !record.archived && revision.id === record.currentRevisionId && !record.reviewRounds?.some(round => round.ownerPackageId === undefined);
  const latest = useRef({ editable, signal, isCurrent });
  const generation = useRef(0);
  const locked = !editable || busy || pending;
  useLayoutEffect(() => { latest.current = { editable, signal, isCurrent }; });
  useLayoutEffect(() => {
    if (editable) return;
    const captured = ++generation.current;
    queueMicrotask(() => { if (mounted.current && generation.current === captured) setReviewed(false); });
  }, [editable]);
  useEffect(() => { dirtyRef.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; dirtyRef.current?.(false); }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  function change(patch: Partial<PackageAssemblySettings>) { setDraft(previous => ({ ...previous, ...patch })); setReviewed(false); setError(''); }
  return <section aria-labelledby={heading} className="min-w-0 space-y-3 rounded border p-2 text-sm sm:p-3" aria-busy={pending}>
    <h3 id={heading} className="font-medium">Assembly layout</h3>
    <p className="text-xs text-muted-foreground">Covers and contents use the assembled PDF’s physical positions. Member continuation and enclosure numbering keep their separate sequences.</p>
    <p role="status">{dirty ? 'Unsaved assembly settings.' : 'Showing saved assembly settings.'}</p>
    {!editable && <p className="text-xs text-muted-foreground">This view is read-only.</p>}
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    <fieldset className="min-w-0 space-y-3" disabled={locked}>
      <label className="block">Assembly profile<select className="mt-1 block w-full min-w-0 rounded border bg-background p-2" aria-label="Assembly profile" value={draft.profile} onChange={event => change({ profile: event.target.value as PackageAssemblySettings['profile'] })}>
        <option value="letter-led">Letter-led</option><option value="forms-led">Forms-led</option><option value="mixed">Mixed documents</option>
      </select></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={draft.cover} onChange={event => change({ cover: event.target.checked })} />Include a package cover</label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={draft.contents} onChange={event => change({ contents: event.target.checked })} />Include linked contents</label>
    </fieldset>
    {dirty && <div className="space-y-3">
      <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} disabled={locked} onChange={event => setReviewed(event.target.checked)} />I reviewed the assembly profile, cover and contents settings for this new package revision.</label>
      <div className="flex flex-wrap gap-2"><Button className="h-auto min-h-9 max-w-full whitespace-normal" disabled={locked || !reviewed} onClick={() => {
        if (running.current) return;
        running.current = true; setPending(true); setError('');
        const captured = generation.current;
        void run(async () => {
          const operationSignal = signal(), current = () => mounted.current && generation.current === captured && latest.current.editable
            && latest.current.isCurrent() && latest.current.signal() === operationSignal && !operationSignal?.aborted;
          try {
            const result = await updatePackageAssemblySettings(record, draft, await getExportDeploymentPolicy(), operationSignal, current);
            if (current()) { dirtyRef.current?.(false); onApply(result); }
          } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Assembly settings could not be saved.'); }
        }).catch(cause => { if (mounted.current && isCurrent()) setError(cause instanceof Error ? cause.message : 'The package operation could not start.'); })
          .finally(() => { running.current = false; if (mounted.current) setPending(false); });
      }}>Save assembly settings</Button>
        <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={locked} onClick={() => { setDraft(structuredClone(saved)); setReviewed(false); setError(''); }}>Discard assembly changes</Button></div>
    </div>}
  </section>;
}
