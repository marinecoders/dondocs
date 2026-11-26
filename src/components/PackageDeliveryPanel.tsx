import { packageDocumentName } from '@/lib/actionPackages';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { buildPackageDeliveryBundle } from '@/lib/packageDeliveryBundle';
import { PackageDeliveryFindings } from './PackageDeliveryFindings';
import { PackageDeliveryBlocked, assertDeliveryRequirements, type PackageRequirementFinding } from '@/lib/packageRequirements';
import type { PackageDestination } from '@/lib/packageDestinations';
import { PackageDeliveryPreview } from './PackageDeliveryPreview';
import { Button } from './ui/button';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { preparePackageDelivery, buildPackageDeliveryFile, assertPackageDeliveryPolicy, type PackageDeliverySelection, type PreparedPackageDelivery } from '@/lib/packageDelivery';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { triggerDownload } from '@/lib/encoding';
import type { CorrespondenceRendererPorts } from '@/services/exports/correspondence';

interface Props {
  record: ActionPackage; revision: PackageRevision; disabled: boolean; busy: boolean;
  ports?: CorrespondenceRendererPorts & { waitForReady(timeoutMs: number): Promise<boolean> };
  run(action: () => Promise<void>): Promise<void>;
  signal(): AbortSignal | undefined; isCurrent(): boolean;
  onPreparedChange?(prepared: PreparedPackageDelivery | null): void;
  initialMemberIds?: string[];
  directDownload?: boolean;
  canSign?: boolean;
  onNavigate?(target: PackageDestination): void;
  visible?: boolean;
}
export function PackageDeliveryPanel(props: Props) {
  return <DeliverySelection key={props.record.id} {...props} />;
}
function DeliverySelection(props: Props) {
  const [selection, setSelection] = useState<PackageDeliverySelection>({ label: 'Selected documents', purpose: 'recipient', scope: props.initialMemberIds ? 'selected' : 'complete', memberIds: props.initialMemberIds ?? [] });
  const [recheck, setRecheck] = useState(false);
  return <DeliveryProfile key={props.record.sequence + ':' + props.revision.id} {...props} selection={selection}
    setSelection={setSelection} recheck={recheck} setRecheck={setRecheck} />;
}
type ProfileProps = Props & { selection: PackageDeliverySelection; setSelection(selection: PackageDeliverySelection): void;
  recheck: boolean; setRecheck(value: boolean): void };
function DeliveryProfile({ record, revision, disabled, busy, ports, run, signal, isCurrent, onPreparedChange, directDownload = false,
  onNavigate, canSign, visible = true, selection, setSelection, recheck, setRecheck }: ProfileProps) {
  const heading = useId();
  const { label, purpose, scope, taggedNativePdfs = false } = selection;
  const memberIds = revision.members.filter(member => scope === 'complete' || selection.memberIds.includes(member.id)).map(member => member.id);
  const [prepared, setPrepared] = useState<PreparedPackageDelivery | null>(null), [approved, setApproved] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [findings, setFindings] = useState<PackageRequirementFinding[]>([]);
  useEffect(() => {
    if (!visible || !recheck || disabled || purpose !== 'recipient') return;
    const controller = new AbortController();
    void assertDeliveryRequirements(revision, scope === 'selected' ? selection.memberIds : undefined, controller.signal)
      .then(() => { if (!controller.signal.aborted) setFindings([]); })
      .catch(cause => { if (!controller.signal.aborted) {
        if (cause instanceof PackageDeliveryBlocked) setFindings(cause.findings);
        else setError(cause instanceof Error ? cause.message : 'Readiness check failed.');
      } });
    return () => controller.abort();
  }, [visible, recheck, revision, selection.memberIds, scope, purpose, disabled]);
  const [reviewCount, setReviewCount] = useState(10), [fileCount, setFileCount] = useState(25);
  const preparedPolicy = useRef<string | undefined>(undefined);
  const mounted = useRef(false), running = useRef(false), generation = useRef(0), callback = useRef(onPreparedChange);
  const latest = useRef({ disabled, signal, isCurrent });
  useLayoutEffect(() => { callback.current = onPreparedChange; }, [onPreparedChange]);
  useLayoutEffect(() => { latest.current = { disabled, signal, isCurrent }; });
  useLayoutEffect(() => {
    if (!disabled) return;
    const captured = ++generation.current; preparedPolicy.current = undefined;
    queueMicrotask(() => { if (mounted.current && generation.current === captured) { setPrepared(null); setApproved(false); callback.current?.(null); } });
  }, [disabled]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; callback.current?.(null); }; }, []);
  useEffect(() => {
    const invalidatePolicy = () => { const policy = getExportDeploymentPolicySync(), identity = policy.status === 'ready' ? JSON.stringify(policy.policy) : '';
      if (preparedPolicy.current && preparedPolicy.current !== identity) { generation.current++; preparedPolicy.current = undefined; setPrepared(null); setApproved(false); callback.current?.(null); } };
    window.addEventListener('focus', invalidatePolicy);
    return () => window.removeEventListener('focus', invalidatePolicy);
  }, []);
  function invalidate() { generation.current++; preparedPolicy.current = undefined; setPrepared(null); setApproved(false); setError(''); setFindings([]); setRecheck(false); callback.current?.(null); }
  const locked = disabled || busy || pending;
  const requiresLayoutReview = prepared?.purpose === 'recipient' && prepared.reviews.some(({ review }) => review.layoutReview);
  const requiresApproval = !directDownload || requiresLayoutReview;
  const acknowledged = !requiresApproval || approved;
  const canTagNativePdfs = purpose === 'recipient'
    && revision.members.some(member => member.kind === 'native' && memberIds.includes(member.id));
  async function perform(action: (current: () => boolean, operationSignal?: AbortSignal) => Promise<void>) {
    if (locked || running.current) return;
    running.current = true; setPending(true); setError(''); const captured = generation.current;
    try { await run(async () => {
      const operationSignal = signal(), current = () => mounted.current && generation.current === captured && !latest.current.disabled
        && latest.current.isCurrent() && latest.current.signal() === operationSignal && !operationSignal?.aborted;
      try { if (current()) await action(current, operationSignal); }
      catch (cause) { if (current()) { if (cause instanceof PackageDeliveryBlocked) {
        setFindings(cause.findings); setRecheck(true);
      } else setError(cause instanceof Error ? cause.message : 'Delivery preparation failed.'); setPrepared(null); setApproved(false); callback.current?.(null); } }
    }); } catch (cause) { if (mounted.current && generation.current === captured && isCurrent()) setError(cause instanceof Error ? cause.message : 'The package operation could not start.'); }
    finally { running.current = false; if (mounted.current) setPending(false); }
  }
  return <section aria-labelledby={heading} className="min-w-0 max-w-4xl space-y-4 border-t pt-4 text-sm" aria-busy={pending}>
    <h3 id={heading} className="font-medium">Recipient delivery</h3>
    <p className="text-xs text-muted-foreground">{purpose === 'editable' ? 'This editable ZIP includes saved answers and embedded attachments for the selected documents.' : 'The ZIP includes the selected documents. Original files retain their signatures.'}</p>
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    {findings.length > 0 && <><p role="alert">{findings.length} delivery {findings.length === 1 ? 'item needs' : 'items need'} attention.</p>
      <PackageDeliveryFindings canSign={canSign} revision={revision} findings={findings} onNavigate={target => onNavigate?.(target)} disabled={locked || !onNavigate} /></>}
    <fieldset disabled={locked} className="min-w-0 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">Delivery name<input aria-label="Delivery name" className="mt-1 block w-full min-w-0 rounded border bg-background p-2" maxLength={120} value={label} onChange={event => { invalidate(); setSelection({ ...selection, label: event.target.value }); }} /></label>
      {purpose === 'recipient' && <label className="block">Delivery scope<select className="mt-1 block w-full rounded border bg-background p-2" value={scope}
        onChange={event => { invalidate(); setSelection({ ...selection, scope: event.target.value as PackageDeliverySelection['scope'], memberIds }); }}>
        <option value="complete">Complete package</option><option value="selected">Selected files only</option>
      </select></label>}
      </div>
      <div className="min-w-0 space-y-2">{revision.members.map(member => <label key={member.id} className="flex items-start gap-2 break-words"><input type="checkbox" checked={memberIds.includes(member.id)} onChange={event => { invalidate(); setSelection({ ...selection, scope: 'selected', memberIds: event.target.checked ? [...memberIds, member.id] : memberIds.filter(id => id !== member.id) }); }} />Include {packageDocumentName(revision, member)}</label>)}</div>
      <details><summary className="cursor-pointer text-xs text-muted-foreground">Delivery options</summary><div className="mt-3 space-y-3">
      <label className="block">Delivery purpose<select aria-label="Delivery purpose" className="mt-1 block w-full min-w-0 rounded border bg-background p-2" value={purpose} onChange={event => { invalidate(); setSelection({ ...selection, purpose: event.target.value as typeof purpose }); }}><option value="recipient">Recipient files</option><option value="editable">Editable handoff</option></select></label>
      <p className="text-xs text-muted-foreground">{purpose === 'editable' ? 'An editable handoff includes saved answers and embedded attachments.' : 'Documents are rendered as PDFs. Uploaded files keep their original format.'}</p>
      {canTagNativePdfs &&
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={taggedNativePdfs} onChange={event => { invalidate(); setSelection({ ...selection, taggedNativePdfs: event.target.checked }); }} />
          <span>Tag supported correspondence PDFs (experimental)<span className="block text-xs text-muted-foreground">Logical reading order and table headings are included. Original files keep their existing accessibility.</span></span>
        </label>}
      </div></details>
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" disabled={!label.trim() || !memberIds.length} onClick={() => void perform(async (current, operationSignal) => {
        const policy = await getExportDeploymentPolicy();
        const value = await preparePackageDelivery(record, revision.id, { label, purpose, scope, memberIds, taggedNativePdfs: canTagNativePdfs && taggedNativePdfs }, policy, ports, operationSignal, current);
        if (current()) { preparedPolicy.current = policy.status === 'ready' ? JSON.stringify(policy.policy) : undefined; setFindings([]); setPrepared(value); setApproved(false); setReviewCount(10); setFileCount(25); callback.current?.(value); }
      })}>Prepare selected delivery</Button>
    </fieldset>
    {prepared && <section aria-label="Captured delivery contents" className="min-w-0 space-y-3 border-t pt-3">
      <h4 className="break-words font-medium">{prepared.packageName}</h4>
      <p>{prepared.members.length} included documents · {prepared.excludedMembers} excluded · {prepared.files.length} captured files</p>
      {prepared.notices.map((notice, index) => <p key={index} className="break-words text-xs text-muted-foreground">{notice}</p>)}
      <ul className="min-w-0 space-y-2">{prepared.files.slice(0, fileCount).map(file => <li key={file.id} className="break-all rounded border p-2 text-xs">{file.name} · {file.size.toLocaleString()} bytes<details className="mt-1 text-muted-foreground"><summary className="cursor-pointer">File checksum</summary><p className="mt-1 font-mono">{file.sha256}</p></details></li>)}</ul>
      {prepared.files.length > fileCount && <Button variant="outline" disabled={locked} onClick={() => setFileCount(value => value + 25)}>Show more included files</Button>}
      {prepared.reviews.slice(0, reviewCount).map((entry, index) => <details key={index} className="min-w-0 rounded border p-2"><summary className="cursor-pointer break-words">{entry.member} · {entry.review.privacy.findings.length} privacy findings</summary>
        {entry.review.notices.map((notice, i) => <p key={i} className="break-words pt-1 text-xs">{notice}</p>)}
        {entry.review.privacy.findings.map((finding, i) => <p key={i} className="break-words pt-1 text-xs">{finding.type}: {finding.value}</p>)}
      </details>)}
      {prepared.reviews.length > reviewCount && <Button variant="outline" disabled={locked} onClick={() => setReviewCount(value => value + 10)}>Show more delivery reviews</Button>}
      <PackageDeliveryPreview key={prepared.revisionId} prepared={prepared} disabled={locked} run={run} signal={signal} isCurrent={isCurrent} />
      {requiresApproval && <label className="flex items-start gap-2"><input type="checkbox" checked={approved} disabled={locked} onChange={event => setApproved(event.target.checked)} />
        {requiresLayoutReview ? 'I reviewed the layout notices and every included document, original PDF, file and privacy finding for this exact delivery.' : 'I reviewed every included document, original PDF, file and privacy finding for this exact delivery.'}
      </label>}
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" disabled={locked || !acknowledged} onClick={() => void perform(async (current, operationSignal) => {
        const bundle = await buildPackageDeliveryBundle(prepared, await getExportDeploymentPolicy(), acknowledged, operationSignal, current);
        if (current()) { assertPackageDeliveryPolicy(prepared, getExportDeploymentPolicySync()); triggerDownload(bundle.bytes, bundle.filename, 'application/zip'); }
      })}>Download reviewed delivery bundle</Button>
      <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={locked || !acknowledged} onClick={() => void perform(async (current, operationSignal) => {
        const json = await buildPackageDeliveryFile(prepared, await getExportDeploymentPolicy(), acknowledged, operationSignal, current);
        if (current()) { assertPackageDeliveryPolicy(prepared, getExportDeploymentPolicySync()); triggerDownload(new TextEncoder().encode(json), 'selected-delivery.dondocs-package.json', 'application/json'); }
      })}>Download reviewed delivery package</Button>
    </section>}
  </section>;
}
