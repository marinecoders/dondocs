import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ReviewSuggestionsPanel } from '@/components/editor/ReviewSuggestionsPanel';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { flushPendingReviewWrites, useDocumentsStore } from '@/stores/documentsStore';
import { readReviewCopyLink, type ReviewRound } from '@/lib/reviewRounds';
import { cachedReviewSuggestions, reviewSuggestionGeneration, subscribeReviewSuggestions } from '@/lib/reviewSuggestionRuntime';
import { decideReviewSuggestion, loadReviewSuggestionWorkspace, submitReviewSuggestion, type ReviewSuggestionWorkspace, type ReviewSuggestionOutcome } from '@/lib/reviewSuggestionActions';
import { emptyReviewSuggestionState } from '@/lib/reviewSuggestions';

export function ReviewSuggestionControls({ rounds, disabled, onBusyChange }: {
  rounds: ReviewRound[]; disabled: boolean; onBusyChange: (value: boolean) => void;
}) {
  const documentId = useDocumentsStore(state => state.currentId);
  useDocumentStore(state => state);
  useSyncExternalStore(subscribeReviewSuggestions, reviewSuggestionGeneration);
  const [linked, setLinked] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [context, setContext] = useState<ReviewSuggestionWorkspace | null>(null);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const alive = useRef(true), running = useRef(false);
  useEffect(() => { alive.current = true;return () => { alive.current = false;onBusyChange(false); }; }, [onBusyChange]);
  useEffect(() => {
    let active = true;
    if (documentId) void readReviewCopyLink(documentId).then(link => { if (active) setLinked(link?.roundId ?? null); })
      .catch(() => { if (active) setError('The reviewer association could not be read. Reopen the review workspace to retry.'); });
    return () => { active = false; };
  }, [documentId]);
  const available = rounds.filter(round => round.ownerDocumentId === documentId || round.id === linked);
  async function run(operation: () => Promise<boolean>): Promise<boolean> {
    if (disabled || running.current) return false;
    running.current = true;setBusy(true);onBusyChange(true);setError('');
    try { return await operation(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'The suggested edits could not be saved. Check the draft’s save status.');return false; }
    finally { running.current = false;if (alive.current) { setBusy(false);onBusyChange(false); } }
  }
  async function select(roundId: string) {
    setSelected(roundId);setContext(null);setNotice('');setPending(false);
    if (roundId) await run(async () => { const value = await loadReviewSuggestionWorkspace(roundId);if (alive.current) setContext(value);return true; });
  }
  async function outcome(value: ReviewSuggestionOutcome): Promise<boolean> {
    if (!alive.current) return false;
    if (value.status !== 'committed' && value.status !== 'pending') throw new Error('The draft or review changed. Reopen this review before deciding or proposing text.');
    setContext(previous => previous && { ...previous, state: value.state });
    setPending(value.status === 'pending');
    setNotice(value.status === 'pending' ? 'The review change is in this draft but is not saved yet. Retry Save before closing or exporting.' : 'Review change saved.');
    return true;
  }
  // Runtime updates are scoped to this activation; Undo/Redo updates the same cache.
  const validContext = context && available.some(round => round.id === context.round.id) ? context : null;
  const cached = validContext ? cachedReviewSuggestions(validContext.target.scope, validContext.round.id) : null;
  const state = cached?.state ?? context?.state;
  return <section aria-label="Suggested edits for this review" className="space-y-3 rounded-md border p-3">
    <h3 className="text-sm font-medium">Suggested edits for this review</h3>
    <p className="text-sm text-muted-foreground">Propose a complete plain paragraph or one supported letter field. Partial text selections, paragraph moves, tables, figures and other structural edits are excluded. Accepting preserves other draft work; overlapping edits require a new review or a deliberate manual edit.</p>
    <p className="text-xs text-muted-foreground">Decisions are retained with the review. Undo and Redo work in the current document session; reopening a document clears the ordinary Undo history.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <Label htmlFor="review-suggestion-round">Review for suggested edits</Label>
    <select id="review-suggestion-round" value={available.some(round => round.id === selected) ? selected : ''} disabled={disabled || busy || pending} className="w-full rounded-md border bg-background p-2 text-sm" onChange={event => void select(event.target.value)}>
      <option value="">Choose a review for this draft</option>
      {available.map(round => <option key={round.id} value={round.id}>{round.label}</option>)}
    </select>
    {!available.length && <p className="text-sm text-muted-foreground">Start a review from this draft or open a linked reviewer copy to propose replacements.</p>}
    {selected && !context && !busy && <Button variant="outline" disabled={disabled} onClick={() => void select(selected)}>Retry suggested edits</Button>}
    {validContext && context && <ReviewSuggestionsPanel key={context.round.id} round={context.round} current={getSerializedSession()}
      state={state ?? emptyReviewSuggestionState(context.round)} owner={context.owner} busy={disabled || busy || pending}
      onCreate={proposal => run(async () => outcome(await submitReviewSuggestion(proposal)))}
      onDecide={(id, action) => run(async () => outcome(await decideReviewSuggestion(context.round.id, id, action)))} />}
    {pending && <Button disabled={disabled || busy} onClick={() => void run(async () => {
      await flushPendingReviewWrites(documentId ?? undefined);
      const value = await loadReviewSuggestionWorkspace(selected);
      if (alive.current) { setContext(value);setPending(false);setNotice('Review change saved.'); }return true;
    })}>Retry suggestion save</Button>}
  </section>;
}
