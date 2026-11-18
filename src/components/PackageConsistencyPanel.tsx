import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { ActionPackage, PackageRevision } from '@/lib/actionPackages';
import { getPackageRevision, newPackageId } from '@/lib/actionPackages';
import { createPackageConsistencyException, inspectPackageConsistency, updatePackageConsistency,
  type PackageConsistency, type PackageConsistencyRule, type PackageConsistencyDestination, type PackageConsistencyInspection } from '@/lib/packageConsistency';
import { reviewPackageConsistency } from '@/lib/actionPackageDisclosure';
import { getExportDeploymentPolicy } from '@/config/classification';
import type { ExportReview } from '@/lib/preparedExport';

interface Props {
  record: ActionPackage;
  revision: PackageRevision;
  disabled: boolean;
  busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  onApply(record: ActionPackage): void;
  signal(): AbortSignal | undefined;
  isCurrent(): boolean;
  onDirtyChange?(dirty: boolean): void;
  onNavigate?(destination: PackageConsistencyDestination): void;
}
const inputClass = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm';
const buttonClass = 'h-auto min-h-9 max-w-full whitespace-normal';
const initialNewRule = () => ({ label: '', relation: 'equal' as PackageConsistencyRule['relation'], participantId: '', leftFactId: '', rightFactId: '', required: true });
const empty = (): PackageConsistency => ({ version: 1, rules: [], exceptions: [] });

/** Explicit relationships compare confirmed values; unrelated people and intentional field overrides remain distinct. */
export function PackageConsistencyPanel({ record, revision, disabled, busy, run, onApply, signal, isCurrent, onDirtyChange, onNavigate }: Props) {
  const heading = useId(), owner = `${record.id}:${record.sequence}:${revision.id}:${record.archived}`;
  const [base, setBase] = useState(() => structuredClone(revision.consistency ?? empty()));
  const [draft, setDraft] = useState(() => structuredClone(revision.consistency ?? empty()));
  const [newRule, setNewRule] = useState(initialNewRule), [reasons, setReasons] = useState<Record<string, string>>({});
  const [inspection, setInspection] = useState<PackageConsistencyInspection | null>(null), [page, setPage] = useState(0);
  const [destinationCounts, setDestinationCounts] = useState<Record<string, number>>({});
  const [review, setReview] = useState<{ value: ExportReview; policy: string } | null>(null), [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const mounted = useRef(false), running = useRef(false), generation = useRef(0), currentOwner = useRef(owner), lastOwner = useRef(owner);
  const dirtyCallback = useRef(onDirtyChange), ownRevision = useRef<string | null>(null);
  const newDirty = JSON.stringify(newRule) !== JSON.stringify(initialNewRule()), pendingReasons = Object.values(reasons).some(Boolean);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base) || newDirty || pendingReasons;
  const editable = !disabled && !record.archived && revision.id === record.currentRevisionId && !record.reviewRounds?.some(round => round.ownerPackageId === undefined);
  const locked = !editable || busy || pending;
  const editableRef = useRef(editable);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(draft.rules.length / 25) - 1));
  useLayoutEffect(() => { currentOwner.current = owner; dirtyCallback.current = onDirtyChange; editableRef.current = editable; }, [owner, onDirtyChange, editable]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; dirtyCallback.current?.(false); }; }, []);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useLayoutEffect(() => {
    if (lastOwner.current === owner) return;
    lastOwner.current = owner; generation.current++;
    const value = structuredClone(revision.consistency ?? empty());
    setBase(value); setDraft(structuredClone(value)); setNewRule(initialNewRule()); setReasons({}); setInspection(null); setReview(null); setReviewed(false); setPage(0); setDestinationCounts({}); setError('');
    if (ownRevision.current !== revision.id) setNotice('');
    ownRevision.current = null;
  }, [owner, revision]);
  const wasEditable = useRef(editable);
  useEffect(() => {
    if (wasEditable.current !== editable) { generation.current++; setReview(null); setReviewed(false); }
    wasEditable.current = editable;
  }, [editable]);
  function invalidate() { generation.current++; setInspection(null); setReview(null); setReviewed(false); setError(''); setNotice(''); }
  function change(next: PackageConsistency) { invalidate(); setDraft(next); }
  async function perform(action: (current: () => boolean) => Promise<void>, requiresEditable = false) {
    if (busy || pending || running.current) return;
    const capturedOwner = owner, capturedGeneration = generation.current;
    running.current = true; setPending(true); setError('');
    try { await run(async () => {
      const capturedSignal = signal();
      const current = () => mounted.current && currentOwner.current === capturedOwner && generation.current === capturedGeneration
        && capturedSignal === signal() && !capturedSignal?.aborted && isCurrent() && (!requiresEditable || editableRef.current);
      try { if (current()) await action(current); }
      catch (cause) { if (current()) { setError(cause instanceof Error ? cause.message : 'The relationship operation failed.'); setReview(null); setReviewed(false); } }
    }); }
    finally { running.current = false; if (mounted.current) setPending(false); }
  }
  const facts = revision.information?.facts ?? [], people = revision.information?.participants ?? [];
  const labelFor = (factId: string) => {
    const fact = facts.find(fact => fact.id === factId), person = people.find(person => person.id === fact?.participantId);
    return fact ? `${person ? `${person.label} (${person.role})` : 'Package'} · ${fact.label}` : 'Unavailable package value';
  };
  const scopedFacts = facts.filter(fact => fact.participantId === undefined || fact.participantId === newRule.participantId);
  const left = scopedFacts.find(fact => fact.id === newRule.leftFactId);
  const candidateFacts = scopedFacts.filter(fact => newRule.relation !== 'date-on-or-before' || fact.kind === 'date');
  const changeNew = (patch: Partial<typeof newRule>) => { invalidate(); setNewRule(value => ({ ...value, ...patch })); };
  const draftChanged = JSON.stringify(draft) !== JSON.stringify(base);
  return <section aria-labelledby={heading} aria-busy={pending} className="min-w-0 space-y-3 rounded-lg border bg-background p-3 sm:p-4">
    <h3 id={heading} className="font-medium">Package relationships</h3>
    <p className="text-sm text-muted-foreground">Compare declared package values for the same person or the package as a whole. Separate people, roles and local field overrides keep their own meaning.</p>
    <p role="status" className="text-xs text-muted-foreground">{dirty ? 'Unapplied relationship changes · not saved yet.' : 'Showing saved relationship declarations.'}</p>
    {!editable && <p className="text-xs text-muted-foreground">This revision is read-only. Its declared relationships can still be inspected.</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!draft.rules.length && <p className="text-sm">No relationships are declared for this revision.</p>}
    {draft.rules.slice(currentPage * 25, (currentPage + 1) * 25).map((rule, index) => {
      const finding = inspection?.findings.find(finding => finding.ruleId === rule.id), exception = draft.exceptions.find(item => item.ruleId === rule.id);
      const targets: PackageConsistencyDestination[] = finding?.destinations ?? [rule.leftFactId, rule.rightFactId].map(factId => ({ factId }));
      return <article key={rule.id} className="min-w-0 space-y-2 rounded border p-3 text-sm">
        <label className="block">Relationship label<input aria-label={`Relationship label ${currentPage * 25 + index + 1}`} className={inputClass} maxLength={160} disabled={locked} value={rule.label}
          onChange={event => change({ ...draft, rules: draft.rules.map(item => item.id === rule.id ? { ...item, label: event.target.value } : item) })} /></label>
        <p className="break-words">{labelFor(rule.leftFactId)} {rule.relation === 'equal' ? 'must equal' : 'must be on or before'} {labelFor(rule.rightFactId)}.</p>
        <label className="flex items-start gap-2"><input type="checkbox" disabled={locked} checked={rule.required} onChange={event => change({ ...draft, rules: draft.rules.map(item => item.id === rule.id ? { ...item, required: event.target.checked } : item) })} />Required before review and PDF assembly</label>
        <p className="break-words">{finding ? `${finding.state}: ${finding.message}` : 'Not inspected for these declarations.'}</p>
        {exception && <div className="space-y-2 rounded border p-2">
          <p className="whitespace-pre-wrap break-words">Local exception: {exception.reason}</p>
          {finding?.staleException && <p className="text-destructive">The saved exception does not apply to these current values.</p>}
          <Button className={buttonClass} variant="outline" disabled={locked} onClick={() => change({ ...draft, exceptions: draft.exceptions.filter(item => item.ruleId !== rule.id) })}>Remove exception for {rule.label || 'relationship'}</Button>
        </div>}
        {finding?.state === 'conflict' && editable && <div className="space-y-2">
          <label className="block">Exception reason<textarea aria-label={`Exception reason for ${rule.label}`} className={inputClass} disabled={locked} maxLength={2000} rows={2} value={reasons[rule.id] ?? ''}
            onChange={event => { generation.current++; setReview(null); setReviewed(false); setReasons(previous => ({ ...previous, [rule.id]: event.target.value })); }} /></label>
          <p className="text-xs text-muted-foreground">An exception records a local decision for these exact values. It does not grant approval.</p>
          <Button className={buttonClass} variant="outline" disabled={locked || !reasons[rule.id]?.trim()} onClick={() => void perform(async current => {
            const value = await createPackageConsistencyException({ ...revision, consistency: draft }, rule.id, reasons[rule.id]);
            if (!current()) return;
            change({ ...draft, exceptions: [...draft.exceptions.filter(item => item.ruleId !== rule.id), value] });
            setReasons(previous => { const next = { ...previous }; delete next[rule.id]; return next; });
          }, true)}>Add exception to changes</Button>
        </div>}
        {onNavigate && <div className="flex flex-wrap gap-2">{targets.slice(0, destinationCounts[rule.id] ?? 20).map((target, targetIndex) =>
          <Button key={`${target.factId}:${'bindingId' in target ? target.bindingId : ''}`} className={buttonClass} variant="outline" size="sm" disabled={busy || pending || dirty || !facts.some(fact => fact.id === target.factId)}
            aria-label={`Inspect ${labelFor(target.factId)} for ${rule.label} · destination ${targetIndex + 1}`} onClick={() => onNavigate(target)}>
            Inspect {labelFor(target.factId)}{'memberId' in target && target.memberId ? ` · ${revision.members.find(member => member.id === target.memberId)?.label ?? 'Unavailable document'}` : ''}
          </Button>)}
          {targets.length > (destinationCounts[rule.id] ?? 20) && <Button className={buttonClass} variant="outline" size="sm" disabled={busy || pending} onClick={() => setDestinationCounts(previous => ({ ...previous, [rule.id]: (previous[rule.id] ?? 20) + 20 }))}>More destinations for {rule.label || 'relationship'}</Button>}
        </div>}
        <Button className={buttonClass} variant="outline" disabled={locked} onClick={() => { change({ ...draft, rules: draft.rules.filter(item => item.id !== rule.id), exceptions: draft.exceptions.filter(item => item.ruleId !== rule.id) }); setReasons(previous => { const next = { ...previous }; delete next[rule.id]; return next; }); }}>Remove relationship {rule.label || index + 1}</Button>
      </article>;
    })}
    {draft.rules.length > 25 && <div className="flex flex-wrap items-center gap-2 text-sm">
      <p>Relationships {currentPage * 25 + 1}–{Math.min((currentPage + 1) * 25, draft.rules.length)} of {draft.rules.length}</p>
      <Button className={buttonClass} variant="outline" disabled={busy || pending || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous relationships</Button>
      <Button className={buttonClass} variant="outline" disabled={busy || pending || (currentPage + 1) * 25 >= draft.rules.length} onClick={() => setPage(currentPage + 1)}>More relationships</Button>
    </div>}
    {editable && <details className="min-w-0 space-y-2 rounded border p-3">
      <summary className="cursor-pointer text-sm font-medium">Add a relationship</summary>
      <fieldset disabled={locked || draft.rules.length >= 100} className="min-w-0 space-y-2 pt-3 text-sm">
        <legend className="sr-only">New package relationship</legend>
        <label className="block">New relationship label<input className={inputClass} maxLength={160} value={newRule.label} onChange={event => changeNew({ label: event.target.value })} /></label>
        <label className="block">Relationship scope<select className={inputClass} value={newRule.participantId} onChange={event => changeNew({ participantId: event.target.value, leftFactId: '', rightFactId: '' })}>
          <option value="">Package-wide values</option>{people.map(person => <option key={person.id} value={person.id}>{person.label} · {person.role}</option>)}
        </select></label>
        <label className="block">Relationship type<select className={inputClass} value={newRule.relation} onChange={event => changeNew({ relation: event.target.value as typeof newRule.relation, leftFactId: '', rightFactId: '' })}>
          <option value="equal">Values must match</option><option value="date-on-or-before">First date on or before second date</option>
        </select></label>
        <label className="block">First package value<select className={inputClass} value={newRule.leftFactId} onChange={event => changeNew({ leftFactId: event.target.value, rightFactId: '' })}>
          <option value="">Choose a confirmed value</option>{candidateFacts.map(fact => <option key={fact.id} value={fact.id}>{labelFor(fact.id)}</option>)}
        </select></label>
        <label className="block">Second package value<select className={inputClass} value={newRule.rightFactId} onChange={event => changeNew({ rightFactId: event.target.value })}>
          <option value="">Choose a confirmed value</option>{candidateFacts.filter(fact => fact.id !== newRule.leftFactId && (!left || fact.kind === left.kind)).map(fact => <option key={fact.id} value={fact.id}>{labelFor(fact.id)}</option>)}
        </select></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={newRule.required} onChange={event => changeNew({ required: event.target.checked })} />Require before review and PDF assembly</label>
        {facts.length < 2 && <p>Confirm at least two package values in Package information before declaring a relationship.</p>}
        <div className="flex flex-wrap gap-2">
          <Button className={buttonClass} variant="outline" disabled={!newRule.label.trim() || !newRule.leftFactId || !newRule.rightFactId} onClick={() => {
            change({ ...draft, rules: [...draft.rules, { id: newPackageId('relationship'), label: newRule.label, relation: newRule.relation, leftFactId: newRule.leftFactId, rightFactId: newRule.rightFactId,
              ...(newRule.participantId ? { participantId: newRule.participantId } : {}), required: newRule.required }] }); setNewRule(initialNewRule());
          }}>Add relationship to changes</Button>
          <Button className={buttonClass} variant="outline" disabled={!newDirty} onClick={() => { invalidate(); setNewRule(initialNewRule()); }}>Clear new relationship</Button>
        </div>
      </fieldset>
    </details>}
    <Button className={buttonClass} variant="outline" disabled={busy || pending} onClick={() => void perform(async current => {
      const value = await inspectPackageConsistency({ ...revision, consistency: draft }, signal()); if (current()) setInspection(value);
    })}>Check declared relationships</Button>
    {inspection && <p role="status" className="text-sm">{inspection.ready ? 'Required declared relationships are satisfied or have current exceptions.' : 'Required declared relationships need attention.'} Other document and evidence checks remain separate.</p>}
    {editable && dirty && <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button className={buttonClass} disabled={locked || !draftChanged || newDirty || pendingReasons} onClick={() => void perform(async current => {
          const policy = await getExportDeploymentPolicy(), value = reviewPackageConsistency(draft, policy);
          if (policy.status !== 'ready') throw new Error(policy.message);
          if (current()) { setReview({ value, policy: JSON.stringify(policy.policy) }); setReviewed(false); }
        }, true)}>Review relationship changes</Button>
        <Button className={buttonClass} variant="outline" disabled={locked} onClick={() => { invalidate(); setDraft(structuredClone(base)); setNewRule(initialNewRule()); setReasons({}); setPage(0); }}>Discard relationship changes</Button>
      </div>
      {review && <div className="space-y-2 rounded border p-3 text-sm">
        {review.value.privacy.findings.map((finding, index) => <p key={index} className="break-words text-xs">{finding.type}: {finding.value}</p>)}
        <label className="flex items-start gap-2"><input type="checkbox" disabled={locked} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the relationship declarations, local exceptions and privacy findings.</label>
        <Button className={buttonClass} disabled={locked || !reviewed} onClick={() => void perform(async current => {
          const policy = await getExportDeploymentPolicy();
          if (policy.status !== 'ready' || JSON.stringify(policy.policy) !== review.policy) throw new Error('Deployment settings changed. Review these relationships again.');
          const value = await updatePackageConsistency(record, draft, policy, signal(), current); if (!current()) return;
          const saved = structuredClone(getPackageRevision(value).consistency ?? empty());
          setBase(saved); setDraft(structuredClone(saved)); setReview(null); setReviewed(false); setInspection(null); setNotice('Relationships saved as a new revision.');
          ownRevision.current = value.currentRevisionId; dirtyCallback.current?.(false); onApply(value);
        }, true)}>Save relationship changes</Button>
      </div>}
    </div>}
  </section>;
}
