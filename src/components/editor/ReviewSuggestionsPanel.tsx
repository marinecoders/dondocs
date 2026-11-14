import { useEffect, useLayoutEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MechanicalReviewProposalsPanel } from './MechanicalReviewProposalsPanel';
import type { SerializedSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { reconcileReviewText } from '@/lib/reconcileReviewText';
import {
  availableReviewSuggestionTargets, createReviewSuggestion, inspectReviewSuggestion, latestReviewSuggestionDecision, REVIEW_SUGGESTION_LIMITS, suggestionTargetKey,
  type ReviewSuggestion, type ReviewSuggestionResolution, type ReviewSuggestionState,
} from '@/lib/reviewSuggestions';

interface Props {
  round: ReviewRound;
  current: SerializedSession;
  state: ReviewSuggestionState;
  owner: boolean;
  busy: boolean;
  onCreate: (proposal: ReviewSuggestion) => Promise<boolean>;
  onDecide: (id: string, action: 'accepted' | 'rejected', resolutions?: readonly ReviewSuggestionResolution[]) => Promise<boolean>;
}

/** The owning workspace supplies the shared persistence/return pipeline. */
export function ReviewSuggestionsPanel({ round, current, state, owner, busy, onCreate, onDecide }: Props) {
  const prefix = useId();
  const [author, setAuthor] = useState('');
  const [selected, setSelected] = useState('');
  const [proposed, setProposed] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [resolution, setResolution] = useState<(ReviewSuggestionResolution & { proposalId: string }) | null>(null);
  const alive = useRef(true), working = useRef(false);
  const result = useRef<HTMLParagraphElement>(null);
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => { if (notice) result.current?.focus({ preventScroll: true }); }, [notice]);
  const disabled = busy || pending;
  const targets = availableReviewSuggestionTargets(round);
  const target = targets.find(item => item.key === selected);
  const targetCounts = new Map<string, number>();
  for (const proposal of state.proposals) for (const change of proposal.changes) {
    const key = suggestionTargetKey(change.target);targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }
  function comparisonName(proposal: ReviewSuggestion, change: { id: string; label: string }, index: number) {
    const target = proposal.changes.find(item => item.id === change.id)!;
    return `${change.label} replacement comparison${(targetCounts.get(suggestionTargetKey(target.target)) ?? 0) > 1 ? `, suggestion ${index + 1}` : ''}`;
  }

  async function add(event: FormEvent) {
    event.preventDefault();setError('');
    if (busy || working.current || !target) return;
    working.current = true;setPending(true);setNotice('');
    try {
      const proposal = createReviewSuggestion(round, { author, label: `Replace ${target.label.toLowerCase()}`,
        changes: [{ target: target.target, proposed }] });
      if (await onCreate(proposal) && alive.current) {
        setSelected('');setProposed('');setNotice('Suggestion submitted to this review.');
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'The suggestion could not be added.'); }
    finally { working.current = false;if (alive.current) setPending(false); }
  }

  async function decide(id: string, action: 'accepted' | 'rejected', resolved?: ReviewSuggestionResolution) {
    if (busy || working.current) return;
    working.current = true;setPending(true);setError('');setNotice('');
    try {
      if (await (resolved ? onDecide(id, action, [resolved]) : onDecide(id, action)) && alive.current) {
        setResolution(null);setNotice('Review decision submitted.');
      }
    }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'The decision could not be recorded.'); }
    finally { working.current = false;if (alive.current) setPending(false); }
  }

  return <section aria-label="Review suggestions" className="space-y-4">
    <h3 className="font-medium">Suggested replacements</h3>
    <p className="text-sm text-muted-foreground">Proposals keep the reviewed baseline unchanged. Only its source drafter can accept or reject them. Reviewer names and local decisions are not authenticated approvals.</p>
    <p ref={result} role="status" aria-label="Suggestion submission status" tabIndex={-1} className={notice ? 'text-sm' : 'sr-only'}>{notice}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <form onSubmit={event => void add(event)} className="space-y-2 rounded-md border p-3">
      <fieldset disabled={disabled || state.proposals.length >= REVIEW_SUGGESTION_LIMITS.proposals} className="space-y-2">
        <legend className="text-sm font-medium">Propose one field or paragraph replacement</legend>
        <Label htmlFor={`${prefix}-author`}>Reviewer name for suggestion</Label>
        <Input id={`${prefix}-author`} value={author} maxLength={100} onChange={event => setAuthor(event.target.value)} />
        <Label htmlFor={`${prefix}-target`}>Suggestion target</Label>
        <select id={`${prefix}-target`} value={selected} className="w-full rounded-md border bg-background p-2 text-sm" onChange={event => {
          const next = targets.find(item => item.key === event.target.value);
          setSelected(event.target.value);setProposed(next?.value ?? '');setError('');
        }}>
          <option value="">Choose a field or whole paragraph</option>
          {targets.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        {target && <>
          <p className="text-xs text-muted-foreground">Reviewed baseline</p>
          <div role="region" aria-label="Suggestion baseline value" tabIndex={0} className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border p-2 text-sm focus-visible:outline-2 focus-visible:outline-ring">{target.value || '(Empty)'}</div>
          <Label htmlFor={`${prefix}-proposed`}>Proposed replacement</Label>
          <Textarea id={`${prefix}-proposed`} value={proposed} maxLength={REVIEW_SUGGESTION_LIMITS.value} rows={4} onChange={event => setProposed(event.target.value)} />
        </>}
        <Button type="submit" disabled={!author.trim() || !target || proposed === target.value}>Add suggestion</Button>
      </fieldset>
    </form>
    <MechanicalReviewProposalsPanel round={round} busy={disabled} proposalCount={state.proposals.length} onCreate={onCreate} />
    {!state.proposals.length && <p className="text-sm text-muted-foreground">No suggested replacements in this review.</p>}
    {state.proposals.map((proposal, index) => {
      const changes = inspectReviewSuggestion(round, current, proposal);
      const decision = latestReviewSuggestionDecision(state, proposal.id);
      const stale = changes.some(change => change.stale);
      const acceptance = decision?.action === 'accepted' ? decision : state.decisions.find(item => item.id === decision?.acceptanceId);
      const currentMatches = changes.every(change => change.current === (acceptance?.resolutions?.find(item => item.changeId === change.id)?.value ?? change.proposed));
      const manualChange = proposal.origin.kind === 'manual' && changes.length === 1 && changes[0].current !== null ? changes[0] : null;
      const editing = resolution?.proposalId === proposal.id ? resolution : null;
      const combination = manualChange && reconcileReviewText(manualChange.baseline, manualChange.current!, manualChange.proposed);
      const status = decision ? decision.action === 'accepted' || decision.action === 'restored' ? currentMatches ? 'Accepted' : 'Accepted earlier; current draft text has changed'
        : decision.action === 'reversed' ? 'Acceptance undone' : 'Rejected' : stale ? 'Current draft differs; acceptance is blocked' : 'Pending';
      return <article key={proposal.id} aria-label={`Suggestion ${index + 1}: ${proposal.label}`} className="space-y-2 rounded-md border p-3">
        <h4 className="break-words text-sm font-medium">{proposal.label}</h4>
        <p className="break-words text-xs text-muted-foreground">{proposal.author} · {new Date(proposal.createdAt).toLocaleString()} · {status}</p>
        {proposal.origin.kind === 'mechanical' && <p className="whitespace-pre-wrap break-words text-xs">Grouped correction{proposal.origin.rule ? `: ${proposal.origin.rule}` : ''}{proposal.origin.context ? ` · ${proposal.origin.context}` : ''}. All members are checked before any change is applied.</p>}
        {changes.map(change => <div key={change.id} className="space-y-1 border-t pt-2">
          <p className="text-sm font-medium">{change.label}</p>
          <div role="region" aria-label={comparisonName(proposal, change, index)} tabIndex={0} className="max-h-60 overflow-auto rounded-md p-1 focus-visible:outline-2 focus-visible:outline-ring">
            <dl className="space-y-2 text-sm">
              {([['Reviewed baseline', change.baseline], ['Current draft', change.current === null ? '(Target unavailable)' : change.current], ['Proposed', change.proposed]] as const).map(([label, value]) => <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{value || '(Empty)'}</dd>
              </div>)}
            </dl>
          </div>
          {acceptance?.resolutions?.map(item => item.changeId === change.id && <div key={item.changeId} className="space-y-1 text-sm">
            <p className="text-xs text-muted-foreground">Accepted resolution</p><p className="whitespace-pre-wrap break-words">{item.value || '(Empty)'}</p>
          </div>)}
        </div>)}
        {owner && (!decision || decision.action === 'reversed') && <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={disabled || stale} onClick={() => void decide(proposal.id, 'accepted')}>Accept suggestion</Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => void decide(proposal.id, 'rejected')}>Reject suggestion</Button>
          {stale && manualChange && <Button size="sm" variant="outline" disabled={disabled} onClick={() => setResolution({ proposalId: proposal.id,
            changeId: manualChange.id, expectedCurrent: manualChange.current!, value: combination!.value })}>Reconcile suggestion</Button>}
        </div>}
        {owner && editing && manualChange && (!decision || decision.action === 'reversed') && <fieldset disabled={disabled} className="space-y-2 rounded-md border p-3">
          <legend className="text-sm font-medium">Resolve this replacement</legend>
          <p className="text-sm">{combination?.kind === 'combined' ? 'Independent edits can be combined. Review the complete result before applying it.' : 'These edits overlap. Keep the current text, use the proposal, or write a combined resolution.'}</p>
          <Label htmlFor={`${prefix}-${proposal.id}-resolution`}>Resolved replacement</Label>
          <Textarea id={`${prefix}-${proposal.id}-resolution`} value={editing.value} rows={4} maxLength={REVIEW_SUGGESTION_LIMITS.value}
            onChange={event => setResolution({ ...editing, value: event.target.value })} />
          {manualChange.current !== editing.expectedCurrent && <p role="alert" className="text-sm text-destructive">The draft changed after reconciliation opened. Cancel and reopen it to review the new current text.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setResolution({ ...editing, value: editing.expectedCurrent })}>Keep current text</Button>
            <Button size="sm" variant="outline" onClick={() => setResolution({ ...editing, value: manualChange.proposed })}>Use proposed text</Button>
            <Button size="sm" disabled={manualChange.current !== editing.expectedCurrent} onClick={() => {
              const { proposalId, ...value } = editing;void decide(proposalId, 'accepted', value);
            }}>Apply resolution</Button>
            <Button size="sm" variant="outline" onClick={() => setResolution(null)}>Cancel reconciliation</Button>
          </div>
        </fieldset>}
      </article>;
    })}
  </section>;
}
