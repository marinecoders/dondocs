import { useEffect, useLayoutEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { FeedbackCategorySelect } from '@/components/FeedbackCategorySelect';
import { feedbackCategoryLabel, matchesFeedbackFilter, type FeedbackCategory, type FeedbackFilter } from '@/lib/reviewFeedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ReviewTypingEditor } from './ReviewTypingEditor';
import { ParagraphStructureProposalsPanel } from './ParagraphStructureProposalsPanel';
import { MechanicalReviewProposalsPanel } from './MechanicalReviewProposalsPanel';
import type { SerializedSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { reconcileReviewText } from '@/lib/reconcileReviewText';
import { captureTextRange, type SelectedTextRange } from '@/lib/reviewTextRanges';
import {
  availableReviewSuggestionTargets, createReviewSuggestion, inspectReviewSuggestionBatch, latestReviewSuggestionDecision, REVIEW_SUGGESTION_LIMITS, suggestionTargetKey,
  type ReviewSuggestion, type ReviewSuggestionResolution, type ReviewSuggestionState,
} from '@/lib/reviewSuggestions';

interface Props {
  round: ReviewRound;
  current: SerializedSession;
  state: ReviewSuggestionState;
  owner: boolean;
  busy: boolean;
  onCreate: (proposal: ReviewSuggestion) => Promise<boolean>;
  onDraftChange?: (dirty: boolean) => void;
  onDecide: (id: string, action: 'accepted' | 'rejected', resolutions?: readonly ReviewSuggestionResolution[]) => Promise<boolean>;
}

/** The owning workspace supplies the shared persistence/return pipeline. */
export function ReviewSuggestionsPanel({ round, current, state, owner, busy, onCreate, onDecide, onDraftChange }: Props) {
  const prefix = useId();
  const [typing, setTyping] = useState(false), [typedDirty, setTypedDirty] = useState(false);
  useEffect(() => { onDraftChange?.(typedDirty);return () => onDraftChange?.(false); }, [typedDirty, onDraftChange]);
  const [author, setAuthor] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('edit');
  const [filter, setFilter] = useState<FeedbackFilter>('all');
  const [selected, setSelected] = useState('');
  const [range, setRange] = useState<SelectedTextRange | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [scopeSelection, setScopeSelection] = useState<{ context: string; start: number; end: number } | null>(null);
  const [proposed, setProposed] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [resolution, setResolution] = useState<(ReviewSuggestionResolution & { proposalId: string; previewContext?: string }) | null>(null);
  const alive = useRef(true), working = useRef(false);
  const result = useRef<HTMLParagraphElement>(null);
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => { if (notice) result.current?.focus({ preventScroll: true }); }, [notice]);
  const disabled = busy || pending;
  const targets = availableReviewSuggestionTargets(round);
  const baseTarget = targets.find(item => item.key === selected);
  const target = range ? { key: suggestionTargetKey(range), label: 'Selected text', target: range, value: range.context.slice(range.start, range.end) } : baseTarget;
  const selectable = baseTarget?.target.kind === 'paragraph' ? captureTextRange(round.baseline.session, baseTarget.target.paragraphId, 0, baseTarget.value.length) : null;
  // Alignment can exhaust its comparison budget for each proposal. Local form
  // input does not change the reviewed source or any retained decision.
  const inspectedProposals = useMemo(() => {
    const displayed = state.proposals.flatMap((proposal, index) => {
      if (!matchesFeedbackFilter(proposal.category, filter)) return [];
      const decision = latestReviewSuggestionDecision(state, proposal.id);
      const acceptance = decision?.action === 'accepted' ? decision : state.decisions.find(item => item.id === decision?.acceptanceId);
      return [{ proposal, index, decision, acceptance }];
    });
    const inspections = inspectReviewSuggestionBatch(round, current, displayed.map(item => ({ proposal: item.proposal, resolutions: item.acceptance?.resolutions })));
    return displayed.map((item, index) => ({ ...item, changes: inspections[index] }));
  }, [round, current, state, filter]);
  function comparisonName(proposal: ReviewSuggestion, change: { id: string; label: string }, index: number) {
    const member = proposal.changes.length > 1 ? `, change ${proposal.changes.findIndex(item => item.id === change.id) + 1}` : '';
    return `${change.label} replacement comparison, suggestion ${index + 1}${member}`;
  }

  async function add(event: FormEvent) {
    event.preventDefault();setError('');
    if (typing || busy || working.current || !target || state.proposals.length >= REVIEW_SUGGESTION_LIMITS.proposals) return;
    working.current = true;setPending(true);setNotice('');
    try {
      const proposal = createReviewSuggestion(round, { author, category, label: `Replace ${target.label.toLowerCase()}`,
        changes: [{ target: target.target, proposed }] });
      if (await onCreate(proposal) && alive.current) {
        setSelected('');setRange(null);setSelection(null);setProposed('');setNotice('Suggestion submitted to this review.');
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'The suggestion could not be added.'); }
    finally { working.current = false;if (alive.current) setPending(false); }
  }

  async function decide(id: string, action: 'accepted' | 'rejected', resolved?: ReviewSuggestionResolution) {
    if (typedDirty || busy || working.current) return;
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
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="text-sm font-medium">Propose a text replacement</legend>
        <Button type="button" variant="outline" aria-pressed={typing} disabled={typedDirty} onClick={() => setTyping(value => !value)}>Suggest Changes mode</Button>
        <Label htmlFor={`${prefix}-author`}>Reviewer name for suggestion</Label>
        <Input id={`${prefix}-author`} value={author} maxLength={100} onChange={event => setAuthor(event.target.value)} />
        <FeedbackCategorySelect label="Suggestion category" value={category} onChange={setCategory} />
        {typing ? <ReviewTypingEditor round={round} current={current} author={author} category={category} disabled={disabled} quotaFull={state.proposals.length >= REVIEW_SUGGESTION_LIMITS.proposals} onCreate={onCreate} onDirtyChange={setTypedDirty} /> : <>
        <Label htmlFor={`${prefix}-target`}>Suggestion target</Label>
        <select id={`${prefix}-target`} value={selected} className="w-full rounded-md border bg-background p-2 text-sm" onChange={event => {
          const next = targets.find(item => item.key === event.target.value);
          setSelected(event.target.value);setRange(null);setSelection(null);setProposed(next?.value ?? '');setError('');
        }}>
          <option value="">Choose a field or whole paragraph</option>
          {targets.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        {selectable && <div className="space-y-2">
          <Label htmlFor={`${prefix}-selection`}>Select text in reviewed paragraph</Label>
          <p className="text-xs text-muted-foreground">Highlight complete words or characters below, then choose Use selected text. The reviewed paragraph stays unchanged.</p>
          <Textarea id={`${prefix}-selection`} readOnly value={baseTarget!.value} rows={4} onSelect={event => {
            const { selectionStart: start, selectionEnd: end } = event.currentTarget;
            setSelection(start < end ? { start, end } : null);
          }} />
          <Button type="button" variant="outline" disabled={!selection} onClick={() => {
            if (!selection) return;
            const captured = captureTextRange(round.baseline.session, selectable.paragraphId, selection.start, selection.end);
            if (!captured) { setError('Select complete characters in supported plain text.');return; }
            setRange(captured);setProposed(captured.context.slice(captured.start, captured.end));setError('');
          }}>Use selected text</Button>
        </div>}
        {target && <>
          <p className="text-xs text-muted-foreground">Reviewed baseline</p>
          <div role="region" aria-label="Suggestion baseline value" tabIndex={0} className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border p-2 text-sm focus-visible:outline-2 focus-visible:outline-ring">{target.value || '(Empty)'}</div>
          <Label htmlFor={`${prefix}-proposed`}>Proposed replacement</Label>
          <Textarea id={`${prefix}-proposed`} value={proposed} maxLength={REVIEW_SUGGESTION_LIMITS.value} rows={4} onChange={event => setProposed(event.target.value)} />
        </>}
        {range && <p className="text-sm">This proposal replaces only the selected text. Acceptance preserves independent edits outside the selection; overlap requires a deliberate resolution.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={state.proposals.length >= REVIEW_SUGGESTION_LIMITS.proposals || !author.trim() || !target || proposed === target.value}>Add suggestion</Button>
          {target && <Button type="button" variant="outline" onClick={() => { setSelected('');setRange(null);setSelection(null);setProposed('');setError(''); }}>Cancel replacement</Button>}
        </div>
        </>}
      </fieldset>
    </form>
    <ParagraphStructureProposalsPanel round={round} author={author} category={category} busy={disabled || typedDirty} proposalCount={state.proposals.length} onCreate={onCreate} />
    <MechanicalReviewProposalsPanel round={round} busy={disabled || typedDirty} proposalCount={state.proposals.length} onCreate={onCreate} />
    {!state.proposals.length && <p className="text-sm text-muted-foreground">No suggested replacements in this review.</p>}
    <FeedbackCategorySelect label="Filter suggestion category" value={filter} onChange={setFilter} filter />
    {inspectedProposals.map(({ proposal, index, decision, acceptance, changes }) => {
      const stale = changes.some(change => change.stale);
      const currentMatches = changes.every(change => change.current === (acceptance?.resolutions?.find(item => item.changeId === change.id)?.value ?? change.proposed));
      const rangeTarget = proposal.changes[0].target.kind === 'range' ? proposal.changes[0].target : null;
      const manualChange = proposal.changes[0].target.kind !== 'structure' && proposal.origin.kind === 'manual' && changes.length === 1 && (changes[0].current !== null || changes[0].reconciliation) ? changes[0] : null;
      const editing = resolution?.proposalId === proposal.id ? resolution : null;
      const combination = manualChange && (rangeTarget ? { kind: 'overlap', value: manualChange.current ?? '' } : reconcileReviewText(manualChange.baseline, manualChange.current!, manualChange.proposed));
      const resolutionStale = !!editing && (rangeTarget ? editing.previewContext !== manualChange?.reconciliation?.currentContext : manualChange?.current !== editing.expectedCurrent);
      const status = decision ? decision.action === 'accepted' || decision.action === 'restored' ? currentMatches ? 'Accepted' : 'Accepted earlier; current draft text has changed'
        : decision.action === 'reversed' ? 'Acceptance undone' : 'Rejected' : stale ? 'Current draft differs; acceptance is blocked' : 'Pending';
      return <article key={proposal.id} aria-label={`Suggestion ${index + 1}: ${proposal.label}`} className="space-y-2 rounded-md border p-3">
        <h4 className="break-words text-sm font-medium">{proposal.label}</h4>
        <p className="text-xs text-muted-foreground">{feedbackCategoryLabel(proposal.category)}{proposal.category === 'required-correction' ? ' · Reviewer intent; not an authenticated approval requirement.' : ''}</p>
        <p className="break-words text-xs text-muted-foreground">{proposal.author} · {new Date(proposal.createdAt).toLocaleString()} · {status}</p>
        {proposal.changes[0].target.kind === 'range' && <p className="text-xs text-muted-foreground">{!proposal.changes[0].expected ? 'Text insertion.' : !proposal.changes[0].proposed ? 'Text deletion.' : 'Selected text replacement.'} Independent edits outside this selection are preserved. Overlap or ambiguous boundaries require your decision.</p>}
        {proposal.changes[0].target.kind === 'structure' && <p className="text-xs text-muted-foreground">{proposal.changes[0].target.operation.kind === 'insert-paragraph' ? 'Insert one new paragraph at the captured gap.' : 'Delete the captured leaf paragraph. Its discussion context and full original content are retained.'} Acceptance checks exact paragraph identities, boundaries and parent. Unrelated current work is preserved; numbering is derived.</p>}
        {proposal.changes[0].target.kind === 'structure' && <details className="text-xs text-muted-foreground">
          <summary>Reviewed paragraph position</summary>
          <p className="whitespace-pre-wrap break-words">Before: {round.baseline.session.paragraphs.find(paragraph => paragraph.id === (proposal.changes[0].target.kind === 'structure' ? proposal.changes[0].target.operation.gap.before?.id : ''))?.text || '(Start of document)'}</p>
          <p className="whitespace-pre-wrap break-words">After: {round.baseline.session.paragraphs.find(paragraph => paragraph.id === (proposal.changes[0].target.kind === 'structure' ? proposal.changes[0].target.operation.gap.after?.id : ''))?.text || '(End of document)'}</p>
        </details>}
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
          <Button size="sm" disabled={disabled || typedDirty || stale} onClick={() => void decide(proposal.id, 'accepted')}>Accept suggestion</Button>
          <Button size="sm" variant="outline" disabled={disabled || typedDirty} onClick={() => void decide(proposal.id, 'rejected')}>Reject suggestion</Button>
          {stale && manualChange && <Button size="sm" variant="outline" disabled={disabled || typedDirty} onClick={() => { setScopeSelection(null);setResolution({ proposalId: proposal.id,
            changeId: manualChange.id, expectedCurrent: manualChange.current ?? '', value: combination!.value,
            ...(rangeTarget ? { previewContext: manualChange.reconciliation?.currentContext } : {}),
            ...(rangeTarget && manualChange.reconciliation?.scope ? { range: manualChange.reconciliation.scope } : {}) }); }}>Reconcile suggestion</Button>}
        </div>}
        {owner && editing && manualChange && (!decision || decision.action === 'reversed') && <fieldset disabled={disabled || typedDirty} className="space-y-2 rounded-md border p-3">
          <legend className="text-sm font-medium">Resolve this replacement</legend>
          <p className="text-sm">{combination?.kind === 'combined' ? 'Independent edits can be combined. Review the complete result before applying it.' : 'These edits overlap. Keep the current text, use the proposal, or write a combined resolution.'}</p>
          {rangeTarget && manualChange.reconciliation && <div className="space-y-2">
            <p className="text-sm">{manualChange.reconciliation.kind === 'ambiguous'
              ? 'The current boundaries cannot be mapped safely. Select the exact current text to replace, or place the caret for an insertion, then choose Use current selection.'
              : 'Only the captured current selection will change. You can deliberately choose another current selection before applying.'}</p>
            <details className="text-sm"><summary>Reviewed paragraph context</summary><p className="whitespace-pre-wrap break-words">{rangeTarget.context}</p></details>
            <Label htmlFor={`${prefix}-${proposal.id}-scope`}>Select current text to resolve</Label>
            <Textarea id={`${prefix}-${proposal.id}-scope`} readOnly value={manualChange.reconciliation.currentContext} rows={4}
              onSelect={event => {
                const { selectionStart: start, selectionEnd: end } = event.currentTarget;
                setScopeSelection({ context: manualChange.reconciliation!.currentContext, start, end });
              }} />
            <Button size="sm" variant="outline" disabled={!scopeSelection} onClick={() => {
              if (!scopeSelection || scopeSelection.context !== manualChange.reconciliation!.currentContext) return;
              const { context, start, end } = scopeSelection;
              const captured = captureTextRange(current, rangeTarget.paragraphId, start, end, { allowCaret: true });
              if (!captured || captured.context !== context) { setError('Choose complete characters in the current paragraph.');return; }
              const expectedCurrent = context.slice(start, end);
              setResolution({ ...editing, range: { context, start, end }, expectedCurrent, value: expectedCurrent });setScopeSelection(null);
            }}>Use current selection</Button>
            {editing.range && <p className="whitespace-pre-wrap break-words text-sm">Current selected scope: {editing.expectedCurrent || '(Insertion point)'}</p>}
          </div>}
          <Label htmlFor={`${prefix}-${proposal.id}-resolution`}>Resolved replacement</Label>
          <Textarea id={`${prefix}-${proposal.id}-resolution`} value={editing.value} rows={4} maxLength={REVIEW_SUGGESTION_LIMITS.value}
            onChange={event => setResolution({ ...editing, value: event.target.value })} />
          {resolutionStale && <p role="alert" className="text-sm text-destructive">The draft changed after reconciliation opened. Cancel and reopen it to review the new current text.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setResolution({ ...editing, value: editing.expectedCurrent })}>Keep current text</Button>
            <Button size="sm" variant="outline" onClick={() => setResolution({ ...editing, value: manualChange.proposed })}>Use proposed text</Button>
            <Button size="sm" disabled={resolutionStale || !!rangeTarget && !editing.range} onClick={() => {
              const { proposalId, previewContext: _previewContext, ...value } = editing;void decide(proposalId, 'accepted', value);
            }}>Apply resolution</Button>
            <Button size="sm" variant="outline" onClick={() => setResolution(null)}>Cancel reconciliation</Button>
          </div>
        </fieldset>}
      </article>;
    })}
  </section>;
}
