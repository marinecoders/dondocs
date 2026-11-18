import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { ActionPackage, PackageMemberReview, PackageReviewRound } from '@/lib/actionPackages';
import { applyPreparedPackageFormCorrection, latestPackageFormDecision, preparePackageFormCorrection, preparePackageFormDecisionUndo, type PreparedPackageFormCorrection } from '@/lib/packageFormCorrections';
import { getExportDeploymentPolicy } from '@/config/classification';
import type { PackageBindingValue } from '@/lib/packageBindingTargets';
import type { PackageUpdateChoices } from '@/lib/packageUpdates';
const input = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm';
const button = 'h-auto min-h-9 max-w-full whitespace-normal';
const display = (value: PackageBindingValue) => value === null ? 'Unanswered' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : value || '(Empty text)';
/** An owning-only detached decision view. Preparation stages bytes privately until explicit acknowledgement. */
export function PackageFormCorrectionPanel({ record, round, child, busy, run, signal, onApply }: {
  record: ActionPackage; round: PackageReviewRound; child: PackageMemberReview; busy: boolean;
  run(action: () => Promise<void>): Promise<void>; signal?(): AbortSignal | undefined; onApply(record: ActionPackage): void;
}) {
  const [mode, setMode] = useState<'local' | 'shared'>('local'), [shared, setShared] = useState('');
  const [choices, setChoices] = useState<PackageUpdateChoices>({}), [prepared, setPrepared] = useState<PreparedPackageFormCorrection | null>(null);
  const [approved, setApproved] = useState(false), [error, setError] = useState('');
  const alive = useRef(false), generation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function invalidate() { generation.current++; setPrepared(null); setApproved(false); setError(''); }
  async function perform(action: (current: () => boolean) => Promise<void>) {
    const revision = generation.current;
    try { await run(async () => { if (alive.current && generation.current === revision) await action(() => alive.current && generation.current === revision); }); }
    catch (cause) { if (alive.current && generation.current === revision) setError(cause instanceof Error ? cause.message : 'The form decision could not be prepared.'); }
  }
  if (round.ownerPackageId !== record.id) return null;
  return <section aria-label="Decide captured form corrections" className="min-w-0 space-y-3 rounded border p-2 sm:p-3">
    <h4 className="font-medium">Decide form corrections</h4>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <label className="block text-sm">Correction scope<select aria-label="Form correction scope" className={input} disabled={busy} value={mode} onChange={event => { invalidate(); setMode(event.target.value as typeof mode); }}>
      <option value="local">Correct this field and preserve a local override</option><option value="shared">Review a linked package-value update</option>
    </select></label>
    {mode === 'shared' && <label className="block text-sm">Replacement package value<input aria-label="Replacement package value" className={input} disabled={busy} value={shared} onChange={event => { invalidate(); setShared(event.target.value); }} /><span className="text-xs text-muted-foreground">Use the package value's declared type and date format. Boolean values use true or false.</span></label>}
    {(child.fieldReview?.proposals ?? []).map(proposal => {
      const decision = latestPackageFormDecision(record, round.id, child.binding.memberId, proposal.id);
      return <article key={proposal.id} className="min-w-0 space-y-2 rounded border p-2 text-sm">
        <p className="break-words font-medium">{proposal.anchor.label}</p><p className="whitespace-pre-wrap break-words">Proposed: {display(proposal.value)}</p>
        {decision ? <><p>{decision.action === 'accepted' ? 'Accepted' : 'Rejected'} in a saved package revision.</p><Button className={button} variant="outline" disabled={busy || record.currentRevisionId !== decision.revisionId} onClick={() => void perform(async current => {
          const value = await preparePackageFormDecisionUndo(record, decision.id, await getExportDeploymentPolicy()); if (current()) { setPrepared(value); setApproved(false); }
        })}>Review Undo for {proposal.anchor.label}</Button></> : <div className="flex flex-wrap gap-2">
          {(['accepted', 'rejected'] as const).map(action => <Button key={action} className={button} variant="outline" disabled={busy} onClick={() => void perform(async current => {
            const value = await preparePackageFormCorrection(record, round.id, child.binding.memberId, proposal.id, action, await getExportDeploymentPolicy(),
              { mode, choices, ...(mode === 'shared' ? { sharedValue: proposal.anchor.kind === 'boolean' ? shared === 'true' ? true : shared === 'false' ? false : shared : shared } : {}) }, signal?.());
            if (current()) { setPrepared(value); setApproved(false); }
          })}>{action === 'accepted' ? 'Review acceptance' : 'Review rejection'} for {proposal.anchor.label}</Button>)}
        </div>}
      </article>;
    })}
    {prepared && <section aria-label="Reviewed form correction preview" className="min-w-0 space-y-2 rounded border p-2 text-sm">
      <p className="font-medium">{prepared.action === 'undo' ? 'Undo decision' : prepared.action === 'accepted' ? 'Accept correction' : 'Reject correction'} · {prepared.proposal.anchor.label}</p>
      <p className="whitespace-pre-wrap break-words">Current: {display(prepared.before)}</p><p className="whitespace-pre-wrap break-words">After: {display(prepared.after)}</p>
      {prepared.issues.map((issue, index) => <p key={index} className="break-words text-destructive">{issue}</p>)}
      {prepared.changes.map(change => <div key={change.bindingId} className="space-y-1 border-t pt-2">
        <p className="break-words">{change.label}: {change.message}</p>
        {change.choices && <label className="block">Linked field decision<select aria-label={`Form linked field decision ${change.bindingId}`} className={input} disabled={busy} value={choices[change.bindingId] ?? ''} onChange={event => {
          const value = event.target.value; invalidate(); const next = { ...choices }; if (value) next[change.bindingId] = value as PackageUpdateChoices[string]; else delete next[change.bindingId]; setChoices(next);
        }}><option value="">Choose and prepare again</option>{change.choices.map(choice => <option key={choice} value={choice}>{choice === 'keep-local' ? 'Preserve current local answer' : choice === 'detach' ? 'Detach field' : 'Apply package value'}</option>)}</select></label>}
      </div>)}
      {prepared.reviews.map((review, index) => <div key={index} className="space-y-1 text-xs">{review.notices.map((notice, ordinal) => <p key={ordinal} className="whitespace-pre-wrap break-words">{notice}</p>)}{review.privacy.findings.map((finding, ordinal) => <p key={ordinal} className="break-words">{finding.type}: {finding.value}</p>)}</div>)}
      <label className="flex items-start gap-2"><input type="checkbox" checked={approved} disabled={busy || !prepared.ready} onChange={event => setApproved(event.target.checked)} />I reviewed this decision, every affected field and the privacy findings.</label>
      <Button className={button} disabled={busy || !approved || !prepared.ready} onClick={() => void perform(async current => {
        const next = await applyPreparedPackageFormCorrection(prepared, await getExportDeploymentPolicy(), approved, signal?.(), current);
        if (current()) { invalidate(); onApply(next); }
      })}>Save reviewed form decision</Button>
    </section>}
  </section>;
}
