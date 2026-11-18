import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PackageSigningPdfPreview } from './PackageSigningPdfPreview';
import { Button } from './ui/button';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { applyPackageSigningReturn, preparePackageSigningReturn, copyPreparedPackageSigningReturn, capturePackageSigningHandoff, copyPreparedPackageSigningSource, copyPreparedPackageSigningHandoff, getPackageSigningPdf, openPackageSigningSource, openCapturedPackageSigningRecord, packageSigningTargets,
  preparePackageSigningHandoff, preparePackageSigningSource, readPackageSigningRecord, reviewPackageSigning,
  type PackageSigningHandoff, type PreparedPackageSigningHandoff, type PreparedPackageSigningSource, type PreparedPackageSigningReturn } from '@/lib/packageSigning';
import { downloadSigningHandoff, listSigningRecords, type SigningRecord } from '@/lib/signingWorkspace';
import { reserveSigningPdfDownload } from '@/utils/signingPdfDownload';
import { triggerDownload } from '@/lib/encoding';
import type { ExportReview } from '@/lib/preparedExport';

const SigningWorkspace = lazy(() => import('./modals/SigningWorkspace'));
interface Props {
  record: ActionPackage; revision: PackageRevision; disabled: boolean; busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  onApply(record: ActionPackage): void; onDirtyChange?(dirty: boolean): void;
  isCurrent(): boolean; signal(): AbortSignal | undefined;
}
const inputClass = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
function PrivacyReview({ reviews }: { reviews: readonly ExportReview[] }) {
  return <div className="space-y-2 text-xs">{reviews.flatMap(review => [...review.notices, ...review.privacy.findings.map(finding => `${finding.type}: ${finding.value}`)])
    .map((text, index) => <p key={index} className="whitespace-pre-wrap break-words">{text}</p>)}</div>;
}

/** Package associations own captured files; the existing signing editor handles placements and external returns. */
export function PackageSigningPanel({ record, revision, disabled, busy, run, onApply, onDirtyChange, isCurrent, signal }: Props) {
  const heading = useId(), owner = `${record.id}:${record.sequence}:${revision.id}:${record.archived}:${disabled}`;
  const [targetKey, setTargetKey] = useState(''), [source, setSource] = useState<PreparedPackageSigningSource | null>(null);
  const [sourceReviewed, setSourceReviewed] = useState(false), [records, setRecords] = useState<SigningRecord[]>([]), [recordId, setRecordId] = useState(''), [handoffId, setHandoffId] = useState('');
  const [handoff, setHandoff] = useState<PreparedPackageSigningHandoff | null>(null), [handoffReviewed, setHandoffReviewed] = useState(false);
  const [retainedReview, setRetainedReview] = useState<{ entry: PackageSigningHandoff; reviews: ExportReview[]; policyKey: string; bytes: Uint8Array; returnId?: string } | null>(null), [retainedReviewed, setRetainedReviewed] = useState(false);
  const [returnedRecord, setReturnedRecord] = useState<SigningRecord | null>(null), [returnId, setReturnId] = useState('');
  const [returnedPlan, setReturnedPlan] = useState<PreparedPackageSigningReturn | null>(null), [returnReviewed, setReturnReviewed] = useState(false), [returnMismatch, setReturnMismatch] = useState(false);
  const [capturedReturnId, setCapturedReturnId] = useState('');
  const [workspaceId, setWorkspaceId] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const ownerRef = useRef(owner), previousOwner = useRef(owner), generation = useRef(0), mounted = useRef(false), running = useRef(false), dirtyCallback = useRef(onDirtyChange);
  const editable = !disabled && !record.archived && revision.id === record.currentRevisionId && !record.reviewRounds?.some(round => round.ownerPackageId === undefined);
  const editableRef = useRef(editable), dirty = !!source || !!handoff || !!returnedPlan;
  const targets = packageSigningTargets(revision), target = targets.find(item => JSON.stringify(item.target) === targetKey);
  const sourceBytes = useMemo(() => source ? copyPreparedPackageSigningSource(source) : null, [source]);
  const handoffBytes = useMemo(() => handoff ? copyPreparedPackageSigningHandoff(handoff) : null, [handoff]);
  const returnedBytes = useMemo(() => returnedPlan ? copyPreparedPackageSigningReturn(returnedPlan) : null, [returnedPlan]);
  const selectedRecord = records.find(item => item.id === recordId), locked = !editable || busy || pending;
  useLayoutEffect(() => { ownerRef.current = owner; editableRef.current = editable; dirtyCallback.current = onDirtyChange; }, [owner, editable, onDirtyChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; dirtyCallback.current?.(false); }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => {
    if (previousOwner.current === owner) return;
    previousOwner.current = owner; generation.current++; setTargetKey(''); setSource(null); setSourceReviewed(false); setRecords([]); setRecordId(''); setHandoffId('');
    setHandoff(null); setHandoffReviewed(false); setRetainedReview(null); setRetainedReviewed(false); setWorkspaceId(''); setReturnedRecord(null); setReturnId(''); setReturnedPlan(null); setReturnReviewed(false); setReturnMismatch(false); setCapturedReturnId(''); setError(''); setNotice('');
  }, [owner]);
  function discard() {
    generation.current++; setSource(null); setSourceReviewed(false); setRecords([]); setRecordId(''); setHandoffId(''); setHandoff(null); setHandoffReviewed(false); setReturnedPlan(null); setReturnReviewed(false); setReturnMismatch(false); setError('');
  }
  async function perform(action: (current: () => boolean) => Promise<void>, requiresEditable = true) {
    if (busy || pending || running.current) return;
    const capturedOwner = owner, capturedGeneration = generation.current;
    running.current = true; setPending(true); setError('');
    let capturedSignal: AbortSignal | undefined;
    const current = () => mounted.current && ownerRef.current === capturedOwner && generation.current === capturedGeneration
      && !capturedSignal?.aborted && isCurrent() && (!requiresEditable || editableRef.current);
    try { await run(async () => {
      capturedSignal = signal();
      try { if (current()) await action(current); }
      catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The package signing operation failed.'); }
    }); }
    catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'The package signing operation could not start.'); }
    finally { running.current = false; if (mounted.current) setPending(false); }
  }
  return <section aria-labelledby={heading} aria-busy={pending} className="min-w-0 space-y-3 rounded-lg border bg-background p-2 sm:p-4">
    <h3 id={heading} className="font-medium">Package signing</h3>
    <p className="text-sm text-muted-foreground">Prepare an exact saved PDF in the signing workspace, then capture the handoff and its signer assignments with this package.</p>
    <p className="text-xs text-muted-foreground">External signing and certificate checks stay in your signing application. Captured handoffs preserve their original revision and file bytes.</p>
    {!editable && <p className="text-xs text-muted-foreground">Signing associations are read-only in this view.</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {editable && <fieldset disabled={locked || !!returnedPlan} className="min-w-0 space-y-3">
      <legend className="sr-only">Prepare package signing</legend>
      <label className="block text-sm">Exact saved PDF<select aria-label="Package signing PDF" className={inputClass} value={targetKey} disabled={!!source} onChange={event => { generation.current++; setTargetKey(event.target.value); setError(''); }}>
        <option value="">Choose a retained PDF or unsigned original</option>{targets.map(item => <option key={JSON.stringify(item.target)} value={JSON.stringify(item.target)}>{item.label}</option>)}
      </select></label>
      {!targets.length && <p className="text-sm">Retain an assembled PDF or add an unsigned original PDF before preparing signing. Editable documents use their saved rendered output.</p>}
      <Button className={buttonClass} variant="outline" disabled={!target || !!source} onClick={() => void perform(async current => {
        const prepared = await preparePackageSigningSource(record, revision.id, target!.target, await getExportDeploymentPolicy(), signal());
        const inventory = await listSigningRecords();
        if (current()) { setRetainedReview(null); setRetainedReviewed(false); setSource(prepared); setSourceReviewed(false); setRecords(inventory.filter(item => item.source.sha256 === prepared.sourceSha256)); }
      })}>Review signing source</Button>
      {source && <div className="min-w-0 space-y-3 rounded border p-3">
        <p className="break-words text-sm">Captured source: {source.filename}</p>
        {!handoff && sourceBytes && <PackageSigningPdfPreview bytes={sourceBytes} label="Exact package signing source PDF" />}
        <PrivacyReview reviews={source.reviews} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={sourceReviewed} onChange={event => setSourceReviewed(event.target.checked)} />I reviewed the exact source PDF, markings and privacy findings before preparing signing.</label>
        <Button className={buttonClass} disabled={!sourceReviewed} onClick={() => void perform(async current => {
          const created = await openPackageSigningSource(source, await getExportDeploymentPolicy(), sourceReviewed, signal(), current, recordId || undefined);
          if (current()) { setRecords(all => [created, ...all.filter(item => item.id !== created.id)]); setRecordId(created.id); setWorkspaceId(created.id); }
        })}>Open signing workspace for this PDF</Button>
        <Button className={buttonClass} variant="outline" onClick={() => void perform(async current => {
          const inventory = await listSigningRecords(); if (current()) { setRecords(inventory.filter(item => item.source.sha256 === source.sourceSha256)); setHandoff(null); setHandoffReviewed(false); }
        })}>Refresh saved signing handoffs</Button>
        <label className="block text-sm">Saved signing record<select aria-label="Package signing record" className={inputClass} value={recordId} onChange={event => { generation.current++; setRecordId(event.target.value); setHandoffId(''); setHandoff(null); setHandoffReviewed(false); }}>
          <option value="">Choose a saved record for this exact PDF</option>{records.map(item => <option key={item.id} value={item.id}>{item.title} · {new Date(item.updatedAt).toLocaleString()}</option>)}
        </select></label>
        {selectedRecord && <>
          <label className="block text-sm">Saved handoff<select aria-label="Package signing handoff" className={inputClass} value={handoffId} onChange={event => { generation.current++; setHandoffId(event.target.value); setHandoff(null); setHandoffReviewed(false); }}>
            <option value="">Choose the exact handoff to capture</option>{selectedRecord.handoffs?.map((item, index) => <option key={item.id} value={item.id}>Handoff {index + 1} · {new Date(item.createdAt).toLocaleString()}</option>)}
          </select></label>
          <Button className={buttonClass} variant="outline" disabled={!handoffId} onClick={() => void perform(async current => {
            const prepared = await preparePackageSigningHandoff(record, revision.id, target!.target, selectedRecord, handoffId, await getExportDeploymentPolicy(), signal());
            if (current()) { setHandoff(prepared); setHandoffReviewed(false); }
          })}>Review exact package handoff</Button>
        </>}
        {handoff && <div className="space-y-3 rounded border p-3 text-sm">
          <p className="break-words">Handoff: {handoff.filename}</p><p className="break-words">Assigned fields: {handoff.signers.join(', ') || 'No assigned signature fields'}</p>
          {handoffBytes && <PackageSigningPdfPreview bytes={handoffBytes} label="Exact prepared package handoff PDF" />}
          <PrivacyReview reviews={handoff.reviews} />
          <label className="flex items-start gap-2"><input type="checkbox" checked={handoffReviewed} onChange={event => setHandoffReviewed(event.target.checked)} />I reviewed the handoff PDF, exact package source and signer assignments.</label>
          <Button className={buttonClass} disabled={!handoffReviewed} onClick={() => void perform(async current => {
            const saved = await capturePackageSigningHandoff(handoff, await getExportDeploymentPolicy(), handoffReviewed, signal(), current);
            if (current()) { dirtyCallback.current?.(false); onApply(saved); }
          })}>Capture handoff in new package revision</Button>
        </div>}
        <Button className={buttonClass} variant="outline" onClick={discard}>Discard signing preparation</Button>
      </div>}
    </fieldset>}
    {(revision.signing?.handoffs ?? []).map((entry, index) => <details key={entry.id} className="min-w-0 rounded border p-2 sm:p-3">
      <summary className="cursor-pointer break-words text-sm font-medium">Captured signing handoff {index + 1}</summary>
      <div className="space-y-3 pt-3 text-sm">
        <p className="break-all">Source revision: {entry.sourceRevisionId}</p><p className="break-words">Assigned fields: {entry.signers.join(', ') || 'No assigned signature fields'}</p>
        <p className="break-all text-xs">Exact handoff SHA-256: {entry.pdfs.handoff.sha256}</p>
        {entry.returns?.map((returned, returnIndex) => <p key={returned.id} className="break-words text-xs">Return {returnIndex + 1}: {returned.returnedAsset.name} · {returned.assessment} · associated, signer authenticity unverified</p>)}
        <Button className={buttonClass} variant="outline" disabled={busy || pending || dirty} onClick={() => void perform(async current => {
          const policy = await getExportDeploymentPolicy();
          if (policy.status !== 'ready') throw new Error(policy.message);
          const reviews = await reviewPackageSigning({ version: 1, handoffs: [entry] }, policy);
          const pdf = await getPackageSigningPdf(entry);
          if (current()) { setRetainedReview({ entry, reviews, bytes: pdf.bytes, policyKey: JSON.stringify(policy.policy) }); setRetainedReviewed(false); setReturnedRecord(null); setReturnId(''); setReturnedPlan(null); setCapturedReturnId(''); }
        }, false)}>Review retained handoff {index + 1}</Button>
      </div>
    </details>)}
    {retainedReview && <div className="min-w-0 space-y-3 rounded border p-3 text-sm">
      <h4 className="font-medium">{retainedReview.returnId ? 'Exact retained signing return' : 'Exact retained signing handoff'}</h4>{!returnedPlan && <PackageSigningPdfPreview bytes={retainedReview.bytes} label={retainedReview.returnId ? 'Exact retained package return PDF' : 'Exact retained package handoff PDF'} />}<PrivacyReview reviews={retainedReview.reviews} />
      <label className="flex items-start gap-2"><input type="checkbox" disabled={busy || pending || dirty} checked={retainedReviewed} onChange={event => setRetainedReviewed(event.target.checked)} />{retainedReview.returnId ? 'I reviewed this exact retained returned PDF and its unverified association before delivering or reopening it.' : 'I reviewed every retained source and handoff page and its signing metadata.'}</label>
      <div className="flex flex-wrap gap-2">
        <Button className={buttonClass} disabled={busy || pending || dirty || !!retainedReview.returnId || !retainedReviewed} onClick={() => void perform(async current => {
          const policy = await getExportDeploymentPolicy();
          if (policy.status !== 'ready' || JSON.stringify(policy.policy) !== retainedReview.policyKey) throw new Error('Deployment settings changed. Review this retained handoff again.');
          await reviewPackageSigning({ version: 1, handoffs: [retainedReview.entry] }, policy);
          const captured = await readPackageSigningRecord(retainedReview.entry), bytes = await downloadSigningHandoff(captured, retainedReview.entry.handoffId);
          const active = getExportDeploymentPolicySync();
          if (active.status !== 'ready' || JSON.stringify(active.policy) !== retainedReview.policyKey) throw new Error('Deployment settings changed. Review this retained handoff again.');
          if (current()) triggerDownload(bytes, `package-signing-handoff-${retainedReview.entry.handoffId}.zip`, 'application/zip');
        }, false)}>Download exact package signing handoff</Button>
        {editable && <Button className={buttonClass} variant="outline" disabled={busy || pending || dirty || !!retainedReview.returnId || !retainedReviewed} onClick={() => void perform(async current => {
          const policy = await getExportDeploymentPolicy();
          if (policy.status !== 'ready' || JSON.stringify(policy.policy) !== retainedReview.policyKey) throw new Error('Deployment settings changed. Review this retained handoff again.');
          const opened = await openCapturedPackageSigningRecord(retainedReview.entry, policy, retainedReviewed, signal(), current);
          if (current()) setWorkspaceId(opened.id);
        })}>Open captured signing workspace</Button>}
      </div>
      {!!retainedReview.entry.returns?.length && <div className="space-y-3 border-t pt-3">
        <label className="block">Captured returned file<select aria-label="Captured package signing return" className={inputClass} disabled={busy || pending || dirty} value={capturedReturnId} onChange={event => { generation.current++; setCapturedReturnId(event.target.value); setRetainedReviewed(false); }}>
          <option value="">Choose a preserved returned PDF</option>{retainedReview.entry.returns.map((returned, index) => <option key={returned.id} value={returned.id}>Return {index + 1}: {returned.returnedAsset.name}</option>)}
        </select></label>
        <Button className={buttonClass} variant="outline" disabled={busy || pending || dirty || !capturedReturnId} onClick={() => void perform(async current => {
          const policy = await getExportDeploymentPolicy(); if (policy.status !== 'ready') throw new Error(policy.message);
          const reviews = await reviewPackageSigning({ version: 1, handoffs: [retainedReview.entry] }, policy);
          const pdf = await getPackageSigningPdf(retainedReview.entry, undefined, capturedReturnId);
          if (current()) { setRetainedReview({ ...retainedReview, reviews, bytes: pdf.bytes, policyKey: JSON.stringify(policy.policy), returnId: capturedReturnId }); setRetainedReviewed(false); }
        }, false)}>Preview captured signing return</Button>
        <Button className={buttonClass} variant="outline" disabled={busy || pending || dirty || !capturedReturnId || retainedReview.returnId !== capturedReturnId || !retainedReviewed} onClick={() => {
          if (running.current || busy || pending) return;
          const lease = reserveSigningPdfDownload();
          void perform(async current => {
          const policy = await getExportDeploymentPolicy();
          if (policy.status !== 'ready' || JSON.stringify(policy.policy) !== retainedReview.policyKey) throw new Error('Deployment settings changed. Review this retained return again.');
          await reviewPackageSigning({ version: 1, handoffs: [retainedReview.entry] }, policy);
          const pdf = await getPackageSigningPdf(retainedReview.entry, undefined, capturedReturnId), active = getExportDeploymentPolicySync();
          if (active.status !== 'ready' || JSON.stringify(active.policy) !== retainedReview.policyKey) throw new Error('Deployment settings changed. Review this retained return again.');
          if (!current()) return;
          const deliverCurrent = () => { const active = getExportDeploymentPolicySync(); return current() && active.status === 'ready' && JSON.stringify(active.policy) === retainedReview.policyKey; };
          if (!await lease.deliver(pdf.bytes, pdf.filename, deliverCurrent)) throw new Error('The returned PDF could not be delivered. Review it again and retry in a supported browser.');
        }, false).finally(() => lease.release());
        }}>Download unchanged captured return</Button>
        {editable && <Button className={buttonClass} variant="outline" disabled={busy || pending || dirty || !capturedReturnId || retainedReview.returnId !== capturedReturnId || !retainedReviewed} onClick={() => void perform(async current => {
          const policy = await getExportDeploymentPolicy();
          if (policy.status !== 'ready' || JSON.stringify(policy.policy) !== retainedReview.policyKey) throw new Error('Deployment settings changed. Review this retained return again.');
          const opened = await openCapturedPackageSigningRecord(retainedReview.entry, policy, retainedReviewed, signal(), current, capturedReturnId);
          if (current()) setWorkspaceId(opened.id);
        })}>Open captured return in signing workspace</Button>}
      </div>}
      {editable && <fieldset disabled={busy || pending || !!source || !!handoff} className="min-w-0 space-y-3 border-t pt-3">
        <legend className="sr-only">Adopt an associated signing return</legend>
        <h4 className="font-medium">Add an associated return</h4>
        <p className="text-xs text-muted-foreground">Associate the returned file with its exact handoff in the signing workspace first. Adding it here preserves every current member and records a supporting original PDF in a new revision.</p>
        <Button className={buttonClass} variant="outline" disabled={!!returnedPlan} onClick={() => void perform(async current => {
          const local = (await listSigningRecords()).find(item => item.id === retainedReview.entry.signingRecordId);
          if (current()) { setReturnedRecord(local ?? null); setReturnId(''); setReturnedPlan(null); setReturnReviewed(false); setReturnMismatch(false); if (!local) setNotice('Open the captured signing workspace and associate the returned PDF before refreshing.'); }
        })}>Refresh associated signing returns</Button>
        {returnedRecord && <label className="block">Associated returned PDF<select aria-label="Associated package signing return" className={inputClass} disabled={!!returnedPlan} value={returnId} onChange={event => { generation.current++; setReturnId(event.target.value); setReturnedPlan(null); setReturnReviewed(false); setReturnMismatch(false); }}>
          <option value="">Choose the exact associated return</option>{returnedRecord.returns?.filter(item => item.handoffId === retainedReview.entry.handoffId).map((returned, index) => <option key={returned.id} value={returned.id}>Return {index + 1}: {returned.pdf.filename} · {returned.evidence.assessment}</option>)}
        </select></label>}
        <Button className={buttonClass} variant="outline" disabled={!returnedRecord || !returnId || !!returnedPlan} onClick={() => void perform(async current => {
          const prepared = await preparePackageSigningReturn(record, retainedReview.entry.id, returnedRecord!, returnId, await getExportDeploymentPolicy(), signal());
          if (current()) { setReturnedPlan(prepared); setReturnReviewed(false); setReturnMismatch(false); }
        })}>Review adding return to package</Button>
        {returnedPlan && <div className="space-y-3 rounded border p-3">
          <p className="break-words">Return: {returnedPlan.filename} · matching evidence: {returnedPlan.assessment}</p>
          <p className="text-xs text-muted-foreground">The current documents stay unchanged. This adds a supporting original tied to the earlier handoff and preserves its unverified association.</p>
          {returnedBytes && <PackageSigningPdfPreview bytes={returnedBytes} label="Returned package PDF to preserve" />}
          <PrivacyReview reviews={returnedPlan.reviews} />
          <label className="flex items-start gap-2"><input type="checkbox" checked={returnReviewed} onChange={event => setReturnReviewed(event.target.checked)} />I reviewed the exact returned PDF, its association and privacy findings, and want to add it as a supporting original.</label>
          {returnedPlan.assessment !== 'checks-agree' && <label className="flex items-start gap-2"><input type="checkbox" checked={returnMismatch} onChange={event => setReturnMismatch(event.target.checked)} />I acknowledge the unchanged, differing or inconclusive match and will preserve it without marking signing complete.</label>}
          <div className="flex flex-wrap gap-2"><Button className={buttonClass} disabled={!returnReviewed || returnedPlan.assessment !== 'checks-agree' && !returnMismatch} onClick={() => void perform(async current => {
            const saved = await applyPackageSigningReturn(returnedPlan, await getExportDeploymentPolicy(), { reviewed: returnReviewed, acceptedMismatch: returnMismatch }, signal(), current);
            if (current()) { dirtyCallback.current?.(false); onApply(saved); }
          })}>Add reviewed return in new package revision</Button>
            <Button className={buttonClass} variant="outline" onClick={() => { generation.current++; setReturnedPlan(null); setReturnReviewed(false); setReturnMismatch(false); }}>Discard return preparation</Button></div>
        </div>}
      </fieldset>}
    </div>}
    {workspaceId && <Suspense fallback={<p role="status">Opening signing workspace…</p>}><SigningWorkspace open initialRecordId={workspaceId} onOpenChange={value => { if (!value) setWorkspaceId(''); }} /></Suspense>}
  </section>;
}
