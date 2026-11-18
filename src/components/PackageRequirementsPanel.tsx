import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { inspectPackageRequirements, updatePackageRequirements, type PackageRequirementOperation, type PackageRequirements, type PackageRequirementsInspection } from '@/lib/packageRequirements';
import { reviewPackageRequirements } from '@/lib/actionPackageDisclosure';
import { resolveConditionalPackageRequirements } from '@/lib/packageConditionalRequirements';
import { getExportDeploymentPolicy } from '@/config/classification';
import type { ExportReview } from '@/lib/preparedExport';
interface Props {
  record: ActionPackage;
  revision: PackageRevision;
  disabled: boolean;
  busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  onApply(record: ActionPackage): void;
  isCurrent(): boolean;
  signal(): AbortSignal | undefined;
  onDirtyChange?(dirty: boolean): void;
}
const inputClass = 'block w-full rounded border bg-background p-2 text-sm';
const operationLabels: Record<PackageRequirementOperation, string> = { review: 'Review', pdf: 'PDF assembly', portable: 'Editable transfer' };

/** Declared evidence slots remain metadata until the user assigns actual captured package content. */
export function PackageRequirementsPanel({ record, revision, disabled, busy, run, onApply, isCurrent, signal, onDirtyChange }: Props) {
  const heading = useId(), owner = `${record.id}:${record.sequence}:${revision.id}`;
  const [base, setBase] = useState<PackageRequirements | undefined>(() => structuredClone(revision.requirements));
  const [draft, setDraft] = useState<PackageRequirements | undefined>(() => structuredClone(revision.requirements));
  const derive = !!revision.templateState && revision.requirements === undefined;
  const [loading, setLoading] = useState(derive);
  const [operation, setOperation] = useState<PackageRequirementOperation>('pdf'), [page, setPage] = useState(0);
  const [inspection, setInspection] = useState<PackageRequirementsInspection | null>(null);
  const [review, setReview] = useState<{ value: ExportReview; policyIdentity: string } | null>(null), [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const currentOwner = useRef(owner), lastOwner = useRef(owner), generation = useRef(0), mounted = useRef(false), running = useRef(false);
  const revisionRef = useRef(revision);
  const dirtyCallback = useRef(onDirtyChange), ownRevision = useRef<string | null>(null);
  const editable = !disabled && !record.archived && revision.id === record.currentRevisionId && !record.reviewRounds?.some(round => round.ownerPackageId === undefined);
  const unavailable = derive && base === undefined;
  const locked = !editable || busy || pending || loading || unavailable;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  useLayoutEffect(() => { currentOwner.current = owner; dirtyCallback.current = onDirtyChange; revisionRef.current = revision; }, [owner, onDirtyChange, revision]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; dirtyCallback.current?.(false); }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => {
    if (lastOwner.current === owner) return;
    lastOwner.current = owner; generation.current++;
    setBase(structuredClone(revision.requirements)); setDraft(structuredClone(revision.requirements)); setLoading(!!revision.templateState && revision.requirements === undefined); setInspection(null); setReview(null); setReviewed(false); setPage(0); setError('');
    if (ownRevision.current !== revision.id) setNotice('');
    ownRevision.current = null;
  }, [owner, revision]);
  const wasEditable = useRef(editable);
  useEffect(() => {
    if (wasEditable.current !== editable) { generation.current++; setReview(null); setReviewed(false); }
    wasEditable.current = editable;
  }, [editable]);
  useEffect(() => {
    if (!derive) return;
    let live = true;
    const capturedOwner = owner, snapshot = revisionRef.current;
    void resolveConditionalPackageRequirements(snapshot).then(value => {
      if (!live || !mounted.current || currentOwner.current !== capturedOwner) return;
      setBase(structuredClone(value)); setDraft(structuredClone(value)); setLoading(false);
    }).catch(cause => {
      if (!live || !mounted.current || currentOwner.current !== capturedOwner) return;
      setLoading(false); setError(cause instanceof Error ? cause.message : 'Captured requirements could not be read. Reopen this package to retry.');
    });
    return () => { live = false; };
  }, [owner, derive]);
  function invalidate() { generation.current++; setInspection(null); setReview(null); setReviewed(false); setError(''); setNotice(''); }
  function edit(next: PackageRequirements) { invalidate(); setDraft(next); }
  async function perform(action: (current: () => boolean) => Promise<void>) {
    if (busy || pending || running.current) return;
    running.current = true; setPending(true); setError('');
    const capturedOwner = owner, capturedGeneration = generation.current;
    const current = () => mounted.current && currentOwner.current === capturedOwner && generation.current === capturedGeneration && isCurrent() && !signal()?.aborted;
    try { await run(async () => {
      try { await action(current); }
      catch (cause) { if (current()) { setError(cause instanceof Error ? cause.message : 'The requirement operation failed.'); setReview(null); setReviewed(false); } }
    }); }
    finally { running.current = false; if (mounted.current) setPending(false); }
  }
  const shown = draft?.items.slice(page * 25, (page + 1) * 25) ?? [];
  return <section aria-labelledby={heading} aria-busy={pending || loading} className="min-w-0 space-y-3 rounded-lg border bg-background p-3 sm:p-4">
    <h3 id={heading} className="font-medium">Evidence and requirements</h3>
    <p className="text-sm text-muted-foreground">Evidence slots are fulfilled by actual captured documents or PDFs. Confirmations record what a user declares; they do not grant approval or independently verify the content.</p>
    <p role="status" className="text-xs text-muted-foreground">{loading ? 'Reading captured requirements…' : unavailable ? 'Captured requirements are unavailable.' : dirty ? 'Unapplied requirement changes · not saved yet.' : 'Showing saved requirement declarations.'}</p>
    {!editable && <p className="text-xs text-muted-foreground">Assignments and declarations are read-only in this view.</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!loading && !unavailable && !draft?.items.length && <p className="text-sm">No evidence requirements are declared for this revision.</p>}
    <fieldset disabled={locked} className="min-w-0 space-y-3">
      <legend className="sr-only">Evidence assignments and user declarations</legend>
      {shown.map(item => {
        const person = revision.information?.participants.find(person => person.id === item.participantId);
        const intakePerson = Object.values(revision.templateState?.answers.groups ?? {}).flat().find(person => person.id === item.participantId);
        const finding = inspection?.items.find(finding => finding.id === item.id);
        return <article key={item.id} className="min-w-0 space-y-2 rounded border p-3">
          <h4 className="break-words text-sm font-medium">{item.label}</h4>
          <p className="text-xs text-muted-foreground">{item.participantId ? `${person?.label ?? intakePerson?.label ?? 'Unavailable person'} · ${person?.role ?? (intakePerson ? 'Intake person' : 'Unknown role')}` : 'Package-wide'} · Required for {item.operations.map(value => operationLabels[value]).join(', ')} · {item.condition === 'active' ? 'Active' : item.condition === 'inactive' ? 'Inactive for saved answers' : 'Condition unresolved'}</p>
          {item.kind === 'document' ? <label className="block text-sm">Captured evidence<select aria-label={`Evidence for ${item.id}`} className={inputClass} value={item.memberId ?? ''} onChange={event => {
            if (!draft) return;
            const next = { ...item }; if (event.target.value) next.memberId = event.target.value; else delete next.memberId;
            edit({ ...draft, items: draft.items.map(value => value.id === item.id ? next : value) });
          }}>
            <option value="">Missing evidence · leave slot unassigned</option>
            {item.memberId && !revision.members.some(member => member.id === item.memberId) && <option value={item.memberId}>Unavailable captured document</option>}
            {revision.members.map((member, index) => <option key={member.id} value={member.id}>{index + 1}. {member.label} · {member.kind === 'native' ? 'Editable document' : 'Original PDF'}</option>)}
          </select></label> : <label className="flex items-start gap-2 text-sm"><input type="checkbox" aria-label={`User declaration for ${item.id}`} checked={item.confirmed === true} onChange={event => {
            if (draft) edit({ ...draft, items: draft.items.map(value => value.id === item.id ? { ...item, confirmed: event.target.checked } : value) });
          }} />I confirm: {item.label}. This is my declaration, not an approval.</label>}
          <p className="break-words text-xs">{finding ? `${finding.state}: ${finding.message}` : 'Not checked for the selected operation. Saving an assignment does not establish overall package readiness.'}</p>
        </article>;
      })}
    </fieldset>
    {(draft?.items.length ?? 0) > 25 && <div className="flex flex-wrap items-center gap-2">
      <p className="text-xs">Requirements {page * 25 + 1}–{Math.min((page + 1) * 25, draft!.items.length)} of {draft!.items.length}</p>
      <Button variant="outline" disabled={busy || pending || page === 0} onClick={() => setPage(value => value - 1)}>Previous requirements</Button>
      <Button variant="outline" disabled={busy || pending || (page + 1) * 25 >= draft!.items.length} onClick={() => setPage(value => value + 1)}>More requirements</Button>
    </div>}
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-sm">Operation to check<select aria-label="Requirement operation" className={inputClass} disabled={busy || pending || loading || unavailable} value={operation} onChange={event => { invalidate(); setOperation(event.target.value as PackageRequirementOperation); }}>
        <option value="review">Review</option><option value="pdf">PDF assembly</option><option value="portable">Editable transfer</option>
      </select></label>
      <Button variant="outline" disabled={busy || pending || loading || unavailable} onClick={() => void perform(async current => {
        const value = await inspectPackageRequirements({ ...revision, requirements: draft }, operation, { signal: signal() });
        if (current()) setInspection(value);
      })}>Check evidence requirements</Button>
    </div>
    {inspection && <p role="status" className="text-sm">{operationLabels[inspection.operation]} requirement checks {inspection.ready ? 'complete' : 'have unresolved items'}. This checks declared requirements only, not overall document readiness or approval.</p>}
    {dirty && <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Saving creates a new package revision. Unassigned evidence and unresolved conditions remain in the draft.</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={locked} onClick={() => void perform(async current => {
          if (!draft) return;
          const policy = await getExportDeploymentPolicy();
          const value = reviewPackageRequirements(draft, policy);
          if (policy.status !== 'ready') throw new Error(policy.message);
          if (current()) { setReview({ value, policyIdentity: policy.policy.identity }); setReviewed(false); }
        })}>Review requirement changes</Button>
        <Button variant="outline" disabled={locked} onClick={() => { invalidate(); setDraft(structuredClone(base)); }}>Discard requirement changes</Button>
      </div>
      {review && <div className="space-y-2 rounded border p-3">
        {review.value.notices.map((notice, index) => <p key={index} className="break-words text-xs">{notice}</p>)}
        {review.value.privacy.findings.map((finding, index) => <p key={index} className="break-words text-xs">{finding.type}: {finding.value}</p>)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={locked} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed these evidence assignments, user declarations and privacy findings.</label>
        <Button disabled={locked || !reviewed} onClick={() => void perform(async current => {
          const policy = await getExportDeploymentPolicy();
          if (policy.status !== 'ready' || policy.policy.identity !== review.policyIdentity) throw new Error('Deployment settings changed. Review the requirement changes again.');
          const value = await updatePackageRequirements(record, draft, policy, signal(), current);
          if (!current()) return;
          ownRevision.current = value.currentRevisionId; setReview(null); setReviewed(false); setBase(structuredClone(value.revisions.find(revision => revision.id === value.currentRevisionId)?.requirements)); setDraft(structuredClone(value.revisions.find(revision => revision.id === value.currentRevisionId)?.requirements));
          dirtyCallback.current?.(false); setNotice('Requirements saved as a new revision. Unresolved evidence remains visible.'); onApply(value);
        })}>Save requirement changes</Button>
      </div>}
    </div>}
  </section>;
}
