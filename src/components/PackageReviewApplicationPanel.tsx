import { useLayoutEffect, useRef, useState } from 'react';
import { StructureReconciliationControls } from './editor/StructureReconciliationControls';
import { PackageContentFindings } from './PackageExportFindings';
import type { ReviewReturnConflict } from '@/lib/reviewCommentMerge';
import { Button } from './ui/button';
import type { ActionPackage, PackageReviewRound } from '@/lib/actionPackages';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { matchPackageReturnRound } from '@/lib/packageReviewTransfer';
import { MAX_PACKAGE_FILE_BYTES } from '@/lib/actionPackageTransfer';
import { previewPackageReviewReturn, inspectPackageReviewApplication, preparePackageReviewApplication, applyPreparedPackageReviewApplication,
  type PackageReviewReturnPreview, type PackageFeedbackChoices, type PackageReviewApplicationPlan, type PreparedPackageReviewApplication } from '@/lib/packageReviewApplication';

function DiscussionValue({ value }: { value: ReviewReturnConflict['baseline'] }) {
  if (value === undefined) return <p>No discussion.</p>;
  if (typeof value === 'boolean') return <p>{value ? 'Resolved' : 'Open'}</p>;
  if (typeof value === 'string') return <p className="whitespace-pre-wrap break-words">{value}</p>;
  const messages = 'messages' in value ? value.messages : [value];
  return <div className="space-y-1">
    {'anchor' in value && <p>{value.resolved ? 'Resolved' : 'Open'} · {value.category ?? 'Uncategorized'} · {value.anchor.kind}{value.anchor.kind === 'range' ? `: ${value.anchor.context.slice(value.anchor.start, value.anchor.end)}` : ''}</p>}
    {messages.map(message => <p key={message.id} className="whitespace-pre-wrap break-words">{message.author}: {message.text}</p>)}
  </div>;
}

export function PackageReviewApplicationPanel({ record, round, busy, run, onApply, isCurrent, signal, workspace = false }: {
  workspace?: boolean;
  record: ActionPackage; round?: PackageReviewRound; busy: boolean; run(action: () => Promise<void>): Promise<void>;
  onApply(record: ActionPackage): void; isCurrent(): boolean; signal(): AbortSignal | undefined;
}) {
  const [matchedRound, setMatchedRound] = useState<PackageReviewRound>();
  const selectedRound = round ?? matchedRound;
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PackageReviewReturnPreview | null>(null), [choices, setChoices] = useState<PackageFeedbackChoices>({});
  const [selectedRanges, setSelectedRanges] = useState<Record<string, { context: string; start: number; end: number }>>({});
  const [plan, setPlan] = useState<PackageReviewApplicationPlan | null>(null), [prepared, setPrepared] = useState<PreparedPackageReviewApplication | null>(null), [approved, setApproved] = useState(false);
  const planResult = useRef<HTMLDivElement>(null), preparedResult = useRef<HTMLDivElement>(null);
  const hasPlan = !!plan;
  useLayoutEffect(() => {
    if (!workspace) return;
    const result = prepared ? preparedResult.current : planResult.current;
    result?.scrollIntoView?.({ block: 'start' }); result?.focus({ preventScroll: true });
  }, [workspace, hasPlan, prepared]);
  function update(next: PackageFeedbackChoices) {
    setChoices(next); setPrepared(null); setApproved(false);
    setError(null);
    if (preview) {
      try { setPlan(inspectPackageReviewApplication(preview, next, getExportDeploymentPolicySync())); }
      catch (error) { setError(error instanceof Error ? error.message : 'Prepare and review this feedback again.'); setPlan(null); setPreview(null); }
    }
  }
  return <section aria-label="Apply package feedback" className="space-y-3 rounded border p-3">
    <h3 className="font-medium">Apply returned package feedback</h3>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">Compare the reviewed baseline, returned proposals and latest saved package. Each application creates one new package revision. Source documents remain separate.</p>
    <label className="block text-sm">Import package feedback return<input aria-label="Import package feedback return" type="file" accept=".json" className="block max-w-full" disabled={busy}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => {
        setError(null); setPrepared(null); setApproved(false); setPlan(null); setPreview(null); setChoices({}); setMatchedRound(undefined); setSelectedRanges({});
        if (file.size > MAX_PACKAGE_FILE_BYTES) throw new Error('Package review files are limited to 100 MB.');
        const json = await file.text();
        const target = matchPackageReturnRound(json, record);
        if (round && round.id !== target.id) throw new Error('This feedback belongs to another review round. Return to the package and import it there.');
        const value = await previewPackageReviewReturn(json, record, target.id, await getExportDeploymentPolicy());
        if (!isCurrent()) return;
        setMatchedRound(target); setPreview(value); setPlan(inspectPackageReviewApplication(value, {}, getExportDeploymentPolicySync()));
      }); }} /></label>
    {plan && <div ref={planResult} tabIndex={-1} className="space-y-4 outline-none">
      {selectedRound && <p className="text-sm">{record.name} · {selectedRound.label} · {selectedRound.revisionId === record.currentRevisionId
        ? 'Reviewed version is current' : 'The package has a newer saved version'}</p>}
      {plan.previews.map(member => <article key={member.memberId} className="space-y-2 rounded border p-2">
        <h4 className="font-medium break-words">{member.label} · {member.status}</h4>
        <p className="text-xs break-all">Reviewed member revision: {member.baseline.revisionId}<br />Current member revision: {member.current?.revisionId ?? 'Removed'}</p>
        {member.status !== 'present' && <label className="block text-sm">Membership decision<select aria-label={`Membership decision ${member.label}`} className="block w-full border bg-background p-2" value={choices[member.memberId]?.member ?? ''} disabled={busy}
          onChange={event => update({ ...choices, [member.memberId]: { ...choices[member.memberId], member: event.target.value as 'current' | 'restore-reviewed' } })}>
          <option value="">Choose membership</option><option value="current">Keep current membership and content</option><option value="restore-reviewed">Restore reviewed member deliberately</option>
        </select></label>}
        {(['baseline', 'current', 'returned'] as const).map(version => <details key={version} className="text-xs" open={version === 'returned'}>
          <summary>{version === 'baseline' ? 'Reviewed baseline discussion' : version === 'current' ? 'Latest saved discussion' : 'Returned discussion'}</summary>
          {(member.discussion[version]?.threads ?? []).map(thread => <div key={thread.id} className="space-y-1 border-l pl-2">
            <p>{thread.resolved ? 'Resolved' : 'Open'} · {thread.anchor.kind}{thread.anchor.kind === 'range' ? `: ${thread.anchor.context.slice(thread.anchor.start, thread.anchor.end)}` : ''}</p>
            {thread.messages.map(message => <p key={message.id} className="whitespace-pre-wrap break-words">{message.author}: {message.text}</p>)}
          </div>)}
          {!member.discussion[version]?.threads.length && <p>No discussion.</p>}
        </details>)}
        <label className="block text-sm">Discussion decision<select aria-label={`Discussion decision ${member.label}`} className="block w-full border bg-background p-2" value={choices[member.memberId]?.comments ?? ''} disabled={busy}
          onChange={event => update({ ...choices, [member.memberId]: { ...choices[member.memberId], comments: event.target.value as 'merge' | 'skip' } })}>
          <option value="">Choose discussion</option><option value="merge">Merge returned discussion</option><option value="skip">Keep current discussion</option>
        </select></label>
        {member.comments.conflicts.map(conflict => <div key={conflict.id} className="space-y-1 text-xs">
          <p>Discussion conflict: {conflict.kind}</p>
          <p>Reviewed baseline</p><DiscussionValue value={conflict.baseline} />
          <p>Latest saved discussion</p><DiscussionValue value={conflict.current} />
          <p>Returned discussion</p><DiscussionValue value={conflict.returned} />
          <select aria-label={`Discussion conflict ${conflict.id}`} value={choices[member.memberId]?.commentConflicts?.[conflict.id] ?? ''} className="w-full border bg-background p-2" disabled={busy}
            onChange={event => update({ ...choices, [member.memberId]: { ...choices[member.memberId], commentConflicts: { ...choices[member.memberId]?.commentConflicts, [conflict.id]: event.target.value as 'current' | 'returned' } } })}>
            <option value="">Choose discussion version</option><option value="current">Current discussion</option><option value="returned">Returned discussion</option>
          </select>
        </div>)}
        {member.proposals.map(proposal => <div key={proposal.id} className="space-y-2 border-t pt-2">
          <p className="text-sm font-medium break-words">{proposal.label}{proposal.decided ? ' · Decision already recorded' : ''}</p>
          {proposal.changes.map(change => <div key={change.id} className="space-y-1 text-xs">
            <p>{change.label}{change.stale ? ' · Newer or conflicting content' : ''}</p>
            <p className="whitespace-pre-wrap break-words">Reviewed baseline: {change.baseline}</p>
            <p className="whitespace-pre-wrap break-words">Latest saved content: {change.current ?? 'Unavailable'}</p>
            <p className="whitespace-pre-wrap break-words">Returned proposal: {change.proposed}</p>
            {!proposal.decided && proposal.structural && change.structureReconciliation && change.structureReconciliation.kind !== 'unchanged' && <StructureReconciliationControls
              source={proposal.structural.source} target={proposal.structural.target} inspection={change.structureReconciliation} changeId={change.id} disabled={busy}
              onDecide={(action, resolution) => update({ ...choices, [member.memberId]: { ...choices[member.memberId], proposals: { ...choices[member.memberId]?.proposals,
                [proposal.id]: { action, ...(resolution ? { resolutions: [resolution] } : {}) } } } })} />}
            {change.reconciliation && <div className="space-y-1">
              <p className="whitespace-pre-wrap break-words">Latest complete paragraph: {change.reconciliation.currentContext}</p>
              <p>Range reconciliation: {change.reconciliation.kind}. Select the exact current text to replace, or place the caret for an insertion, then choose Use selected current text.</p>
              <textarea readOnly aria-label={`Select current text ${change.id}`} value={change.reconciliation.currentContext} className="block min-h-20 w-full border bg-background p-2"
                onSelect={event => { const field = event.currentTarget; setSelectedRanges({ ...selectedRanges, [change.id]: { context: field.value, start: field.selectionStart, end: field.selectionEnd } }); }} />
              <Button variant="outline" disabled={busy || proposal.decided || !selectedRanges[change.id]} onClick={() => {
                const prior = choices[member.memberId]?.proposals?.[proposal.id], scope = selectedRanges[change.id];
                if (!scope || scope.context !== change.reconciliation!.currentContext) return;
                update({ ...choices, [member.memberId]: { ...choices[member.memberId], proposals: { ...choices[member.memberId]?.proposals,
                  [proposal.id]: { action: prior?.action ?? 'keep', resolutions: [{ changeId: change.id, range: scope, expectedCurrent: scope.context.slice(scope.start, scope.end), value: prior?.resolutions?.[0]?.value ?? change.proposed }] } } } });
              }}>Use selected current text</Button>
              {choices[member.memberId]?.proposals?.[proposal.id]?.resolutions?.[0]?.range && <p className="whitespace-pre-wrap break-words">Selected current text: {choices[member.memberId].proposals![proposal.id].resolutions![0].expectedCurrent || '(Insertion point)'}</p>}
            </div>}
            {!change.structureReconciliation && change.stale && (change.current !== null || change.reconciliation) && <label className="block">Deliberate replacement for current content<textarea aria-label={`Resolved replacement ${change.id}`} className="block min-h-20 w-full border bg-background p-2" disabled={busy || proposal.decided}
              value={choices[member.memberId]?.proposals?.[proposal.id]?.resolutions?.find(item => item.changeId === change.id)?.value ?? ''}
              onChange={event => {
                const prior = choices[member.memberId]?.proposals?.[proposal.id];
                update({ ...choices, [member.memberId]: { ...choices[member.memberId], proposals: { ...choices[member.memberId]?.proposals,
                  [proposal.id]: { action: prior?.action ?? 'keep', resolutions: [{ changeId: change.id, expectedCurrent: prior?.resolutions?.[0]?.range ? prior.resolutions[0].range.context.slice(prior.resolutions[0].range.start, prior.resolutions[0].range.end) : change.current ?? '', value: event.target.value, ...(change.reconciliation?.scope || prior?.resolutions?.[0]?.range ? { range: prior?.resolutions?.[0]?.range ?? change.reconciliation?.scope } : {}) }] } } } });
              }} /></label>}
          </div>)}
          <select aria-label={`Proposal decision ${proposal.label}`} className="w-full border bg-background p-2 text-sm" value={choices[member.memberId]?.proposals?.[proposal.id]?.action ?? ''} disabled={busy}
            onChange={event => {
              const action = event.target.value as 'accepted' | 'rejected' | 'keep';
              const resolutions = action === 'accepted' ? choices[member.memberId]?.proposals?.[proposal.id]?.resolutions : undefined;
              update({ ...choices, [member.memberId]: { ...choices[member.memberId], proposals: { ...choices[member.memberId]?.proposals,
                [proposal.id]: { action, ...(resolutions ? { resolutions } : {}) } } } });
            }}>
            <option value="">Choose proposal action</option><option value="keep">Keep proposal pending or retain recorded decision</option>
            {!proposal.decided && <><option value="accepted">Accept reviewed replacement</option><option value="rejected">Reject proposal</option></>}
          </select>
        </div>)}
        {member.issues.map((issue, index) => <p key={index} className="text-xs text-muted-foreground">{issue}</p>)}
      </article>)}
      <Button disabled={busy || !plan.ready || !preview} onClick={() => void run(async () => {
        if (!preview) return;
        const value = await preparePackageReviewApplication(preview, choices, await getExportDeploymentPolicy());
        if (isCurrent()) { setPrepared(value); setApproved(false); }
      })}>Review new package revision</Button>
    </div>}
    {prepared && <div ref={preparedResult} tabIndex={-1} className="space-y-3 outline-none">
      <p className="font-medium">Review the new package revision and retained feedback</p>
      {workspace ? <PackageContentFindings reviews={prepared.reviews.map(review => ({ member: '', review }))} /> : prepared.reviews.map((review, index) => <div key={index} className="space-y-1 text-xs">
        {review.notices.map((notice, index) => <p key={index} className="whitespace-pre-wrap break-words">{notice}</p>)}
        {review.privacy.findings.map((finding, index) => <p key={index} className="whitespace-pre-wrap break-words">{finding.type}: {finding.value}</p>)}
      </div>)}
      {!workspace && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />I reviewed the baseline, current content, returned proposals, discussion choices and privacy findings for this new revision.</label>}
      <Button disabled={busy || !workspace && !approved} onClick={() => void run(async () => {
        const policy = await getExportDeploymentPolicy();
        const result = await applyPreparedPackageReviewApplication(prepared, policy, signal(), () => {
          const sync = getExportDeploymentPolicySync();
          return isCurrent() && sync.status === 'ready' && policy.status === 'ready' && JSON.stringify(sync.policy) === JSON.stringify(policy.policy);
        });
        if (isCurrent()) { onApply(result); setPrepared(null); setPreview(null); setPlan(null); }
      })}>Apply feedback as new package revision</Button>
    </div>}
    {(preview || prepared) && <Button variant="outline" disabled={busy} onClick={() => { setPreview(null); setPrepared(null); setPlan(null); setChoices({}); setApproved(false); }}>Cancel feedback application</Button>}
    {selectedRound && !!record.reviewApplications?.length && <div className="space-y-1 text-xs"><p>Saved feedback applications</p>{record.reviewApplications.filter(item => item.roundId === selectedRound.id).map(item => <details key={item.id}><summary className="break-all">Return {item.returnId} · New revision {item.revisionId}</summary>{item.feedback.map(child => <details key={child.binding.memberId} open className="space-y-1 border-l pl-2">
      <summary>Returned feedback for {selectedRound.baseline.members.find(member => member.id === child.binding.memberId)?.label ?? child.binding.memberId}</summary>
      {child.comments.threads.map(thread => <DiscussionValue key={thread.id} value={thread} />)}
      {!child.comments.threads.length && <p>No returned discussion.</p>}
      {child.suggestions?.proposals.map(proposal => <div key={proposal.id} className="space-y-1">
        <p className="font-medium">{proposal.author}: {proposal.label}</p>
        {proposal.changes.map(change => <p key={change.id} className="whitespace-pre-wrap break-words">{change.expected || '(Empty)'} → {change.proposed || '(Empty)'}</p>)}
      </div>)}
    </details>)}{item.outcomes.map(outcome => <div key={outcome.memberId} className="space-y-1 border-l pl-2"><p>Member {outcome.memberId} · Discussion: {outcome.choice.comments}</p>{outcome.comments?.threads.flatMap(thread => thread.messages.map(message => <p key={message.id} className="whitespace-pre-wrap break-words">{message.author}: {message.text}</p>))}{outcome.suggestions?.decisions.map(decision => <p key={decision.id}>{outcome.suggestions!.proposals.find(proposal => proposal.id === decision.proposalId)?.label}: {decision.action}</p>)}</div>)}</details>)}</div>}
  </section>;
}
