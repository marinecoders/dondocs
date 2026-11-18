import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { PackageDeliveryPreview } from './PackageDeliveryPreview';
import { Button } from './ui/button';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { preparePackageDelivery, buildPackageDeliveryFile, type PackageDeliverySelection, type PreparedPackageDelivery } from '@/lib/packageDelivery';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { triggerDownload } from '@/lib/encoding';
import type { CorrespondenceRendererPorts } from '@/services/exports/correspondence';

interface Props {
  record: ActionPackage; revision: PackageRevision; disabled: boolean; busy: boolean;
  ports?: CorrespondenceRendererPorts & { waitForReady(timeoutMs: number): Promise<boolean> };
  run(action: () => Promise<void>): Promise<void>;
  signal(): AbortSignal | undefined; isCurrent(): boolean;
  onPreparedChange?(prepared: PreparedPackageDelivery | null): void;
}
export function PackageDeliveryPanel(props: Props) {
  return <DeliveryProfile key={`${props.record.id}:${props.record.sequence}:${props.revision.id}`} {...props} />;
}
function DeliveryProfile({ record, revision, disabled, busy, ports, run, signal, isCurrent, onPreparedChange }: Props) {
  const heading = useId(), [label, setLabel] = useState('Selected documents'), [purpose, setPurpose] = useState<PackageDeliverySelection['purpose']>('recipient');
  const [memberIds, setMemberIds] = useState<string[]>(() => revision.members.map(member => member.id));
  const [prepared, setPrepared] = useState<PreparedPackageDelivery | null>(null), [approved, setApproved] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [reviewCount, setReviewCount] = useState(10), [fileCount, setFileCount] = useState(25);
  const preparedPolicy = useRef<string | undefined>(undefined);
  const mounted = useRef(false), running = useRef(false), generation = useRef(0), callback = useRef(onPreparedChange);
  useLayoutEffect(() => { callback.current = onPreparedChange; }, [onPreparedChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; callback.current?.(null); }; }, []);
  useEffect(() => {
    const invalidatePolicy = () => { const policy = getExportDeploymentPolicySync(), identity = policy.status === 'ready' ? JSON.stringify(policy.policy) : '';
      if (preparedPolicy.current && preparedPolicy.current !== identity) { generation.current++; preparedPolicy.current = undefined; setPrepared(null); setApproved(false); callback.current?.(null); } };
    window.addEventListener('focus', invalidatePolicy);
    return () => window.removeEventListener('focus', invalidatePolicy);
  }, []);
  function invalidate() { generation.current++; preparedPolicy.current = undefined; setPrepared(null); setApproved(false); setError(''); callback.current?.(null); }
  const locked = disabled || busy || pending;
  async function perform(action: (current: () => boolean, operationSignal?: AbortSignal) => Promise<void>) {
    if (locked || running.current) return;
    running.current = true; setPending(true); setError(''); const captured = generation.current;
    try { await run(async () => {
      const operationSignal = signal(), current = () => mounted.current && generation.current === captured && isCurrent() && signal() === operationSignal && !operationSignal?.aborted;
      try { if (current()) await action(current, operationSignal); }
      catch (cause) { if (current()) { setError(cause instanceof Error ? cause.message : 'Delivery preparation failed.'); setPrepared(null); setApproved(false); callback.current?.(null); } }
    }); } catch (cause) { if (mounted.current && generation.current === captured && isCurrent()) setError(cause instanceof Error ? cause.message : 'The package operation could not start.'); }
    finally { running.current = false; if (mounted.current) setPending(false); }
  }
  return <section aria-labelledby={heading} className="min-w-0 space-y-3 rounded border p-2 text-sm sm:p-3" aria-busy={pending}>
    <h3 id={heading} className="font-medium">Recipient delivery</h3>
    <p className="text-xs text-muted-foreground">Choose the exact captured members for an independent delivery copy. Review its actual files and content before downloading.</p>
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    <fieldset disabled={locked} className="min-w-0 space-y-3">
      <label className="block">Delivery name<input aria-label="Delivery name" className="mt-1 block w-full min-w-0 rounded border bg-background p-2" maxLength={120} value={label} onChange={event => { invalidate(); setLabel(event.target.value); }} /></label>
      <label className="block">Delivery purpose<select aria-label="Delivery purpose" className="mt-1 block w-full min-w-0 rounded border bg-background p-2" value={purpose} onChange={event => { invalidate(); setPurpose(event.target.value as typeof purpose); }}><option value="recipient">Recipient PDFs</option><option value="editable">Editable handoff</option></select></label>
      <p className="text-xs text-muted-foreground">Recipient copies render selected native documents as PDFs. Editable handoffs include their full retained answers and embedded attachments.</p>
      <div className="min-w-0 space-y-2">{revision.members.map(member => <label key={member.id} className="flex items-start gap-2 break-words"><input type="checkbox" checked={memberIds.includes(member.id)} onChange={event => { invalidate(); setMemberIds(previous => event.target.checked ? [...previous, member.id] : previous.filter(id => id !== member.id)); }} />Include {member.label}</label>)}</div>
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" disabled={!label.trim() || !memberIds.length} onClick={() => void perform(async (current, operationSignal) => {
        const policy = await getExportDeploymentPolicy();
        const value = await preparePackageDelivery(record, revision.id, { label, purpose, memberIds }, policy, ports, operationSignal, current);
        if (current()) { preparedPolicy.current = policy.status === 'ready' ? JSON.stringify(policy.policy) : undefined; setPrepared(value); setApproved(false); setReviewCount(10); setFileCount(25); callback.current?.(value); }
      })}>Prepare selected delivery</Button>
    </fieldset>
    {prepared && <section aria-label="Captured delivery contents" className="min-w-0 space-y-3 border-t pt-3">
      <h4 className="break-words font-medium">{prepared.packageName}</h4>
      <p>{prepared.members.length} included documents · {prepared.excludedMembers} excluded · {prepared.files.length} captured files</p>
      {prepared.notices.map((notice, index) => <p key={index} className="break-words text-xs text-muted-foreground">{notice}</p>)}
      <ul className="min-w-0 space-y-2">{prepared.files.slice(0, fileCount).map(file => <li key={file.id} className="break-all rounded border p-2 text-xs">{file.name} · {file.size.toLocaleString()} bytes<p>SHA-256 {file.sha256}</p></li>)}</ul>
      {prepared.files.length > fileCount && <Button variant="outline" disabled={locked} onClick={() => setFileCount(value => value + 25)}>Show more included files</Button>}
      {prepared.reviews.slice(0, reviewCount).map((entry, index) => <details key={index} className="min-w-0 rounded border p-2"><summary className="cursor-pointer break-words">{entry.member} · {entry.review.privacy.findings.length} privacy findings</summary>
        {entry.review.notices.map((notice, i) => <p key={i} className="break-words pt-1 text-xs">{notice}</p>)}
        {entry.review.privacy.findings.map((finding, i) => <p key={i} className="break-words pt-1 text-xs">{finding.type}: {finding.value}</p>)}
      </details>)}
      {prepared.reviews.length > reviewCount && <Button variant="outline" disabled={locked} onClick={() => setReviewCount(value => value + 10)}>Show more delivery reviews</Button>}
      <PackageDeliveryPreview key={prepared.revisionId} prepared={prepared} disabled={locked} run={run} signal={signal} isCurrent={isCurrent} />
      <label className="flex items-start gap-2"><input type="checkbox" checked={approved} disabled={locked} onChange={event => setApproved(event.target.checked)} />I reviewed every included document, original PDF, file and privacy finding for this exact delivery.</label>
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" disabled={locked || !approved} onClick={() => void perform(async (current, operationSignal) => {
        const json = await buildPackageDeliveryFile(prepared, await getExportDeploymentPolicy(), approved, operationSignal, current);
        if (current()) triggerDownload(new TextEncoder().encode(json), 'selected-delivery.dondocs-package.json', 'application/json');
      })}>Download reviewed delivery package</Button>
    </section>}
  </section>;
}
