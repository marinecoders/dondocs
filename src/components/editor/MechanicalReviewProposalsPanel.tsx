import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createMechanicalReviewProposal, mechanicalReviewCandidates } from '@/lib/mechanicalReviewProposals';
import type { BodyDateAudience } from '@/lib/mechanicalCorrections';
import type { ReviewRound } from '@/lib/reviewRounds';
import { REVIEW_SUGGESTION_LIMITS, type ReviewSuggestion } from '@/lib/reviewSuggestions';

interface Props {
  round: ReviewRound;
  busy: boolean;
  proposalCount: number;
  onCreate: (proposal: ReviewSuggestion) => Promise<boolean>;
}
interface Draft { scope: string; author: string; audience: BodyDateAudience | null; selected: readonly string[] | null }
const emptyDraft = (scope: string): Draft => ({ scope, author: '', audience: null, selected: null });

/** Proposal creation uses the same owning callback as manual review suggestions. */
export function MechanicalReviewProposalsPanel({ round, busy, proposalCount, onCreate }: Props) {
  const prefix = useId(), scope = `${round.id}:${round.baselineDigest}`;
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(scope));
  const [feedback, setFeedback] = useState({ scope, error: '', notice: '' });
  const [pending, setPending] = useState(false);
  const alive = useRef(true), working = useRef(false), currentScope = useRef(scope);
  const prepared = useRef<{ key: string; proposal: ReviewSuggestion } | null>(null);
  const result = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { currentScope.current = scope; }, [scope]);
  useEffect(() => { alive.current = true;return () => { alive.current = false; }; }, []);
  const values = draft.scope === scope ? draft : emptyDraft(scope);
  const status = feedback.scope === scope ? feedback : { error: '', notice: '' };
  let candidates: ReturnType<typeof mechanicalReviewCandidates> = [], findingError = '';
  try { candidates = mechanicalReviewCandidates(round, values.audience); }
  catch (cause) { findingError = cause instanceof Error ? cause.message : 'The formatting findings could not be prepared.'; }
  const selectable = candidates.filter(candidate => candidate.after !== undefined);
  const selected = values.selected ?? selectable.map(candidate => candidate.id);
  const disabled = busy || pending || proposalCount >= REVIEW_SUGGESTION_LIMITS.proposals;

  function update(fields: Partial<Omit<Draft, 'scope'>>) {
    setDraft(previous => ({ ...(previous.scope === scope ? previous : emptyDraft(scope)), ...fields }));
    setFeedback({ scope, error: '', notice: '' });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || working.current || findingError || !selected.length) return;
    working.current = true;setPending(true);setFeedback({ scope, error: '', notice: '' });
    try {
      const key = JSON.stringify({ scope, author: values.author.trim(), audience: values.audience, selected: [...selected].sort() });
      if (prepared.current?.key !== key) prepared.current = { key, proposal: createMechanicalReviewProposal(round,
        { author: values.author, bodyAudience: values.audience, selectedIds: selected }) };
      const saved = await onCreate(prepared.current.proposal);
      if (saved && alive.current && currentScope.current === scope) {
        setDraft(previous => previous.scope === scope ? { ...previous, selected: [] } : previous);
        setFeedback({ scope, error: '', notice: 'Formatting proposal submitted. Draft text is unchanged.' });
        prepared.current = null;
        requestAnimationFrame(() => { if (alive.current && currentScope.current === scope) result.current?.focus({ preventScroll: true }); });
      } else if (!saved && alive.current && currentScope.current === scope) setFeedback({ scope, error: 'The proposal was not submitted. Review the current draft and try again.', notice: '' });
    } catch (cause) {
      if (alive.current && currentScope.current === scope) setFeedback({ scope, error: cause instanceof Error ? cause.message : 'The formatting proposal could not be submitted.', notice: '' });
    } finally { working.current = false;if (alive.current) setPending(false); }
  }

  return <section aria-label="Formatting review proposals" className="space-y-3 rounded-md border p-3">
    <h3 className="font-medium">Propose formatting corrections</h3>
    <p className="text-sm text-muted-foreground">Use the existing formatting checks on the reviewed baseline. Selected corrections become one proposal; the drafter decides whether to apply it.</p>
    <p className="text-xs text-muted-foreground">Reference ordering and citation relabeling remain in the reference tools.</p>
    <p ref={result} role="status" aria-label="Formatting proposal status" tabIndex={-1} className={status.notice ? 'text-sm' : 'sr-only'}>{status.notice}</p>
    {(status.error || findingError) && <p role="alert" className="text-sm text-destructive">{status.error || findingError}</p>}
    <form onSubmit={event => void submit(event)}>
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="sr-only">Formatting proposal selection</legend>
        <Label htmlFor={`${prefix}-author`}>Reviewer name for formatting corrections</Label>
        <Input id={`${prefix}-author`} value={values.author} maxLength={100} onChange={event => update({ author: event.target.value })} />
        <Label htmlFor={`${prefix}-audience`}>Body date audience for review</Label>
        <select id={`${prefix}-audience`} value={values.audience ?? ''} className="w-full rounded-md border bg-background p-2 text-sm"
          onChange={event => update({ audience: event.target.value === 'military' || event.target.value === 'civilian' ? event.target.value : null, selected: null })}>
          <option value="">Choose an audience to check body dates</option>
          <option value="military">Military — 5 November 2026</option>
          <option value="civilian">Civilian — November 5, 2026</option>
        </select>
        {proposalCount >= REVIEW_SUGGESTION_LIMITS.proposals && <p className="text-sm text-muted-foreground">This review has reached its suggestion limit.</p>}
        {!candidates.length && !findingError && <p className="text-sm text-muted-foreground">No supported formatting corrections in this reviewed baseline.</p>}
        {candidates.some(candidate => candidate.source === 'references') && <p className="text-xs text-muted-foreground">Reference-title corrections can be accepted only while the full reference list still matches the reviewed baseline.</p>}
        {candidates.map((candidate, index) => <article key={candidate.id} aria-label={`Formatting finding ${index + 1}: ${candidate.label}`} className="space-y-2 border-t pt-3">
          <div className="flex items-start gap-2">
            {candidate.after !== undefined ? <>
              <Checkbox id={`${prefix}-finding-${index}`} checked={selected.includes(candidate.id)} onCheckedChange={checked => update({ selected: checked === true
                ? [...selected, candidate.id] : selected.filter(id => id !== candidate.id) })} />
              <Label htmlFor={`${prefix}-finding-${index}`}>{candidate.label}</Label>
            </> : <p className="text-sm font-medium">{candidate.label}: manual review required</p>}
          </div>
          <p className="text-xs text-muted-foreground">{candidate.message}</p>
          <dl className="space-y-1 text-sm">
            <div><dt className="text-xs text-muted-foreground">Reviewed value</dt><dd className="whitespace-pre-wrap break-words">{candidate.before}</dd></div>
            {candidate.after !== undefined && <div><dt className="text-xs text-muted-foreground">Proposed</dt><dd className="whitespace-pre-wrap break-words">{candidate.after}</dd></div>}
          </dl>
          {candidate.range && <details className="text-sm">
            <summary>Baseline context</summary>
            <div role="region" aria-label={`Context for formatting finding ${index + 1}`} tabIndex={0}
              className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border p-2 focus-visible:outline-2 focus-visible:outline-ring">{candidate.sourceText}</div>
          </details>}
        </article>)}
        <Button type="submit" disabled={!values.author.trim() || !selected.length || !!findingError}>Propose {selected.length} {selected.length === 1 ? 'correction' : 'corrections'}</Button>
      </fieldset>
    </form>
  </section>;
}
