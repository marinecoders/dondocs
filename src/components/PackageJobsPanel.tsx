import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { discardPackageJob, listPackageJobs, preparePackageJob, runPreparedPackageJob, type PackageJobProgress, type PreparedPackageJob } from '@/lib/packageJobs';
import type { PackageJob } from '@/lib/packageJobModel';
import type { assemblePackage } from '@/lib/actionPackageAssembly';
import { Button } from './ui/button';

interface Props {
  record: ActionPackage; revision: PackageRevision; disabled: boolean; busy: boolean;
  ports: Parameters<typeof assemblePackage>[1];
  run(action: () => Promise<void>): Promise<void>;
  signal(): AbortSignal | undefined; isCurrent(): boolean; onApply(record: ActionPackage): void;
}
export function PackageJobsPanel(props: Props) {
  const heading = useId();
  return <details className="min-w-0 space-y-3 rounded border p-2 text-sm sm:p-3">
    <summary id={heading} className="cursor-pointer break-words font-medium">Resumable PDF assembly</summary>
    <Jobs key={`${props.record.id}:${props.record.sequence}:${props.revision.id}:${props.disabled}`} heading={heading} {...props} />
  </details>;
}
function Jobs({ heading, ...props }: Props & { heading: string }) {
  const [jobs, setJobs] = useState<PackageJob[]>([]), [prepared, setPrepared] = useState<PreparedPackageJob | null>(null);
  const [reviewed, setReviewed] = useState(false), [pending, setPending] = useState(false), [progress, setProgress] = useState<PackageJobProgress | null>(null), [error, setError] = useState('');
  const mounted = useRef(false), running = useRef(false), controller = useRef<AbortController | null>(null), generation = useRef(0), inventory = useRef(0), latest = useRef(props), policy = useRef('');
  useLayoutEffect(() => { latest.current = props; if (props.disabled) controller.current?.abort(); }, [props]);
  useEffect(() => {
    mounted.current = true;
    const request = ++inventory.current;
    void listPackageJobs(props.record.id).then(value => { if (mounted.current && request === inventory.current) setJobs(value); }).catch(cause => { if (mounted.current && request === inventory.current) setError(message(cause)); });
    const invalidate = () => {
      const value = getExportDeploymentPolicySync(), identity = value.status === 'ready' ? JSON.stringify(value.policy) : '';
      if (policy.current && policy.current !== identity) { generation.current++; controller.current?.abort(); setPrepared(null); setReviewed(false); }
    };
    window.addEventListener('focus', invalidate);
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('focus', invalidate); };
  }, [props.record.id]);
  function message(cause: unknown): string { return cause instanceof Error ? cause.message : 'The package job could not finish.'; }
  const readOnly = props.disabled || props.record.archived || props.record.reviewRounds?.some(round => round.ownerPackageId === undefined);
  const locked = readOnly || props.busy || pending;
  async function perform(action: (current: () => boolean, signal: AbortSignal) => Promise<void>) {
    if (locked || running.current) return;
    running.current = true; setPending(true); setError(''); const captured = generation.current;
    const local = new AbortController(); controller.current = local;
    try { await props.run(async () => {
      const parentSignal = props.signal(), abort = () => local.abort(parentSignal?.reason);
      if (parentSignal?.aborted) abort(); else parentSignal?.addEventListener('abort', abort, { once: true });
      const current = () => mounted.current && !latest.current.disabled && captured === generation.current && latest.current.isCurrent()
        && latest.current.signal() === parentSignal && !local.signal.aborted;
      try { if (current()) await action(current, local.signal); }
      catch (cause) { if (mounted.current && captured === generation.current && latest.current.isCurrent()) { setError(local.signal.aborted ? 'Assembly paused. Saved checkpoints remain available after a fresh review.' : message(cause)); setPrepared(null); setReviewed(false); } }
      finally { parentSignal?.removeEventListener('abort', abort); }
    }); } catch (cause) { if (mounted.current && captured === generation.current && latest.current.isCurrent()) setError(message(cause)); }
    finally {
      running.current = false; controller.current = null;
      if (mounted.current) { setPending(false); const request = ++inventory.current; void listPackageJobs(props.record.id).then(value => { if (mounted.current && request === inventory.current) setJobs(value); }).catch(cause => { if (mounted.current && request === inventory.current) setError(message(cause)); }); }
    }
  }
  const prepare = (job?: PackageJob) => void perform(async (current, signal) => {
    setPrepared(null); setReviewed(false); setProgress(null);
    const selectedPolicy = await getExportDeploymentPolicy();
    const result = await preparePackageJob(props.record, job?.revisionId ?? props.revision.id, selectedPolicy, { resumeJobId: job?.id, signal, isCurrent: current });
    if (current()) { policy.current = selectedPolicy.status === 'ready' ? JSON.stringify(selectedPolicy.policy) : ''; setPrepared(result); }
  });
  return <section aria-labelledby={heading} aria-busy={pending} className="min-w-0 space-y-3 pt-3">
      <p className="text-xs text-muted-foreground">Save generated member PDFs as assembly proceeds. After a pause or reload, review the captured revision again to reuse its checked files. Original files keep their preserved bytes. Jobs stay in this browser and are excluded from package transfers and workspace backups.</p>
      {readOnly && <p className="text-xs text-muted-foreground">This view is read-only.</p>}
      {error && <p role="alert" className="break-words text-destructive">{error}</p>}
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" disabled={locked || !props.revision.members.length} onClick={() => prepare()}>Review resumable assembly</Button>
      {progress && <div role="status" className="min-w-0 space-y-1"><p>{progress.completed} of {progress.total} documents assembled · {progress.reused} saved PDFs reused</p><progress aria-label="Documents assembled" className="w-full" value={progress.completed} max={progress.total} /></div>}
      {pending && <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" onClick={() => { controller.current?.abort(); generation.current++; setPrepared(null); setReviewed(false); setError('Assembly paused. Saved checkpoints remain available after a fresh review.'); }}>Pause assembly</Button>}
      {prepared && <div className="min-w-0 space-y-3 border-t pt-3">
        <p className="break-all text-xs">Captured revision {prepared.revisionId}</p>
        {prepared.readiness.findings.map((finding, index) => <p key={index} className="break-words text-xs">{finding.severity}: {finding.message}</p>)}
        {prepared.reviews.map((entry, index) => <details key={index} className="min-w-0 rounded border p-2"><summary className="cursor-pointer break-words">{entry.member} · {entry.review.privacy.findings.length} privacy findings</summary>
          {entry.review.notices.map((notice, i) => <p className="break-words pt-1 text-xs" key={i}>{notice}</p>)}
          {entry.review.privacy.findings.map((finding, i) => <p className="break-words pt-1 text-xs" key={i}>{finding.type}: {finding.value}</p>)}
        </details>)}
        <label className="flex items-start gap-2"><input type="checkbox" disabled={locked} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed every captured document, original file, readiness finding and privacy review for this exact assembly.</label>
        <Button className="h-auto min-h-9 max-w-full whitespace-normal" disabled={locked || !reviewed || prepared.readiness.findings.some(finding => finding.severity === 'error')} onClick={() => void perform(async (current, signal) => {
          const result = await runPreparedPackageJob(prepared, await getExportDeploymentPolicy(), reviewed, props.ports, { signal, isCurrent: current, onProgress: value => { if (current()) setProgress(value); } });
          if (current()) { setPrepared(null); setReviewed(false); props.onApply(result); }
        })}>{prepared.resuming ? 'Resume reviewed assembly' : 'Start reviewed assembly'}</Button>
      </div>}
      <div className="min-w-0 space-y-2"><h4 className="font-medium">Saved jobs</h4>
        {!jobs.length && <p className="text-xs text-muted-foreground">No saved assembly jobs for this package.</p>}
        {jobs.map(job => <div key={job.id} className="min-w-0 space-y-2 rounded border p-2">
          <p className="break-all text-xs">Revision {job.revisionId}</p><p>{job.status === 'running' && job.lease!.expiresAt <= Date.now() ? 'Interrupted' : job.status} · {job.completed} of {job.total} documents</p>
          {job.status === 'complete' && <p className="text-xs text-muted-foreground">The completed PDF is retained with this saved revision.</p>}
          <div className="flex min-w-0 flex-wrap gap-2">
            {job.status !== 'complete' && <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={locked || !!job.lease && job.lease.expiresAt > Date.now()} onClick={() => prepare(job)}>Review saved job</Button>}
            <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={locked || !!job.lease && job.lease.expiresAt > Date.now()} onClick={() => void perform(async (current) => { setPrepared(null); setReviewed(false); await discardPackageJob(job, current); })}>Remove saved job</Button>
          </div>
        </div>)}
      </div>
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={locked} onClick={() => void perform(async current => { const request = ++inventory.current; const value = await listPackageJobs(props.record.id); if (current() && request === inventory.current) setJobs(value); })}>Refresh saved jobs</Button>
    </section>;
}
