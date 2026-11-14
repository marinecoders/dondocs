import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocumentsStore, flushPendingReviewWrites } from '@/stores/documentsStore';
import { readReviewCopyLink } from '@/lib/reviewRounds';
import { MAX_REVIEW_RETURN_BYTES } from '@/lib/reviewReturns';
import { type CommentMessage, type CommentThread, type ReviewComments } from '@/lib/reviewComments';
import { type ReviewCommentMerge, type ReviewReturnChoice, type ReviewReturnConflict } from '@/lib/reviewCommentMerge';
import {
  applyReviewReturn, downloadReviewReturn, prepareReviewReturnExport, prepareReviewReturnImport,
  reviewReturnPlan, reviewReturnTargetLabel, type PreparedReviewReturnExport, type PreparedReviewReturnImport,
} from '@/lib/reviewReturnActions';
import type { ReviewSuggestion } from '@/lib/reviewSuggestions';
import { getPIITypeLabel } from '@/services/pii/detector';

const regionClass = 'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border p-2 text-sm [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring';

function DiscussionValue({ value }: { value: ReviewReturnConflict['current'] }) {
  if (typeof value === 'boolean') return <p>{value ? 'Resolved' : 'Open'}</p>;
  if (!value) return <p>Removed</p>;
  const thread = 'messages' in value ? value as CommentThread : null;
  const messages = thread ? thread.messages : [value as CommentMessage];
  return <div className="space-y-2">
    {thread && <><p>{thread.resolved ? 'Resolved' : 'Open'}</p>{thread.anchor.kind !== 'document' && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">Captured context: {thread.anchor.context || '(Empty)'}</p>}</>}
    {messages.map(message => <p key={message.id} className="whitespace-pre-wrap [overflow-wrap:anywhere]"><strong>{message.author}:</strong> {message.text}</p>)}
  </div>;
}

function Discussions({ comments, label, target }: { comments: ReviewComments | undefined; label: string; target?: (id: string) => string }) {
  return <details className="text-sm"><summary className="cursor-pointer font-medium">{label} ({comments?.threads.length ?? 0})</summary>
    <div role="region" aria-label={label} tabIndex={0} className={`${regionClass} mt-2 space-y-3`}>
      {!comments?.threads.length && <p>No discussions.</p>}
      {comments?.threads.map((thread, index) => <article key={thread.id} className="space-y-1 border-b pb-2 last:border-b-0">
        <h5 className="font-medium">{target?.(thread.id) ?? `Discussion ${index + 1}`} · {thread.resolved ? 'Resolved' : 'Open'}</h5>
        <DiscussionValue value={thread} />
      </article>)}
    </div>
  </details>;
}

function Proposals({ proposals, label }: { proposals: readonly ReviewSuggestion[]; label: string }) {
  return <details className="text-sm"><summary className="cursor-pointer font-medium">{label} ({proposals.length})</summary>
    <div role="region" aria-label={label} tabIndex={0} className={`${regionClass} mt-2 space-y-3`}>
      {proposals.map(proposal => <article key={proposal.id} className="space-y-2 border-b pb-2 last:border-b-0">
        <p><strong>{proposal.label}</strong> · {proposal.author}</p>
        {proposal.origin.rule && <p>{proposal.origin.rule}</p>}{proposal.origin.context && <p>{proposal.origin.context}</p>}
        {proposal.changes.map(change => <dl key={change.id} className="space-y-1"><dt>Reviewed value</dt><dd>{change.expected || '(Empty)'}</dd><dt>Proposed replacement</dt><dd>{change.proposed || '(Empty)'}</dd></dl>)}
      </article>)}
    </div>
  </details>;
}

export function ReviewReturnControls({ disabled, onBusyChange }: { disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const documentId = useDocumentsStore(state => state.currentId);
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [outgoing, setOutgoing] = useState<PreparedReviewReturnExport | null>(null);
  const [incoming, setIncoming] = useState<PreparedReviewReturnImport | null>(null);
  const [incomingValue, setIncomingValue] = useState<unknown>(null);
  const [choices, setChoices] = useState<Record<string, ReviewReturnChoice>>({});
  const [plan, setPlan] = useState<ReviewCommentMerge | null>(null);
  const [outdated, setOutdated] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const [finished, setFinished] = useState(false);
  const active = useRef(true), running = useRef(false), feedback = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => { if (notice) feedback.current?.focus(); }, [notice]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false;onBusyChange(false); };
  }, [onBusyChange]);
  useEffect(() => {
    let current = true;
    if (documentId) void readReviewCopyLink(documentId).then(link => { if (current) setLinked(link !== null); })
      .catch(() => { if (current) setError('The reviewer association could not be read. Retry after checking browser storage.'); });
    return () => { current = false; };
  }, [documentId]);
  const working = disabled || busy;
  async function run(operation: () => Promise<void>) {
    if (disabled || running.current) return;
    running.current = true;setBusy(true);onBusyChange(true);setError('');setNotice('');
    try { await operation(); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'The feedback return could not finish. Keep the file and check the draft’s save status.'); }
    finally { running.current = false;if (active.current) { setBusy(false);onBusyChange(false); } }
  }
  const announce = (message: string) => {
    setNotice(message);
  };
  async function inspect(value: unknown) {
    const prepared = await prepareReviewReturnImport(value);
    if (active.current) {
      setIncoming(prepared);setPlan(prepared.plan);setChoices({});setOutdated(false);setPendingSave(false);setFinished(false);setOutgoing(null);
    }
  }
  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];event.target.value = '';
    if (!file) return;
    setIncoming(null);setIncomingValue(null);setPlan(null);setPendingSave(false);setFinished(false);setOutdated(false);
    void run(async () => {
      if (file.size > MAX_REVIEW_RETURN_BYTES) throw new Error('Review returns are limited to 2 MB.');
      let value: unknown;
      try { value = JSON.parse(await file.text()); }
      catch { throw new Error('Choose a readable feedback return JSON file exported by DonDocs.'); }
      if (active.current) setIncomingValue(value);
      await inspect(value);
    });
  }
  function choose(id: string, value: ReviewReturnChoice) {
    if (!incoming) return;
    const next = { ...choices, [id]: value };
    try { setPlan(reviewReturnPlan(incoming, next));setChoices(next);setError(''); }
    catch (cause) { setOutdated(true);setError(cause instanceof Error ? cause.message : 'Review the current draft again.'); }
  }
  return <section className="space-y-3 rounded-md border p-3" aria-label="Return and receive review feedback">
    <h3 className="text-sm font-medium">Return and receive feedback</h3>
    <p className="text-sm text-muted-foreground">Return discussions and explicit suggested replacements to the original draft. Suggestions remain pending until the drafter accepts them. Other edits made in a reviewer copy are excluded. Reviewer names are self-entered.</p>
    <p ref={feedback} role="status" tabIndex={-1} className={notice ? 'text-sm' : 'sr-only'}>{notice}</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="outline" disabled={working || !linked} onClick={() => void run(async () => {
      const prepared = await prepareReviewReturnExport();if (active.current) { setOutgoing(prepared);setIncoming(null);setPlan(null); }
    })}>Prepare feedback return</Button>
    {!linked && <p className="text-xs text-muted-foreground">Open a linked reviewer copy to export feedback. The original draft receives returned files below.</p>}
    {outgoing && <div className="space-y-2 rounded-md border p-3 text-sm" aria-label="Review outgoing feedback">
      <h4 className="font-medium">Review feedback before downloading</h4>
      <p className="[overflow-wrap:anywhere]">{outgoing.roundLabel} · {outgoing.marking}</p>
      <p>This unencrypted JSON file includes reviewer names, full discussion text, suggested replacements and retained context. Check who may receive it. It excludes the full draft and attachment files; captured context may quote letter text.</p>
      {outgoing.customMarkings.map(marking => <p key={marking} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{marking}</p>)}
      {outgoing.notices.map(notice => <p key={notice}>{notice}</p>)}
      <p>{outgoing.privacy.found ? `Possible sensitive information: ${[...new Set(outgoing.privacy.findings.map(finding => getPIITypeLabel(finding.type)))].join(', ')}.` : 'The privacy scan found no recognized patterns. Review all returned text yourself.'}</p>
      <Proposals proposals={outgoing.proposals} label="Outgoing suggested replacements" />
      <Discussions comments={outgoing.comments} label="Outgoing discussions" />
      <div className="flex flex-wrap gap-2"><Button disabled={working} onClick={() => {
        try { downloadReviewReturn(outgoing);setOutgoing(null);announce('Feedback return sent to browser downloads.'); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'The feedback download could not start.'); }
      }}>Download feedback return</Button><Button variant="ghost" disabled={working} onClick={() => setOutgoing(null)}>Cancel feedback download</Button></div>
    </div>}
    <div className="space-y-2"><Label htmlFor="review-return-file">Import feedback return</Label>
      <Input id="review-return-file" type="file" accept=".json,application/json" disabled={working} onChange={importFile} />
    </div>
    {incoming && plan && <div className="space-y-3 rounded-md border p-3 text-sm" aria-label="Review incoming feedback">
      <h4 className="font-medium">{incoming.roundLabel}</h4>
      <p>Return created {new Date(incoming.createdAt).toLocaleString()} · {incoming.marking}</p>
      <p>Current draft handling: {incoming.currentMarking}. Letter fields, body text and attachments will be kept.</p>
      {incoming.customMarkings.map(marking => <p key={marking} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{marking}</p>)}
      {incoming.notices.map(notice => <p key={notice}>{notice}</p>)}
      {incoming.privacy.found && <p className="text-warning">Returned text may contain sensitive information: {[...new Set(incoming.privacy.findings.map(finding => getPIITypeLabel(finding.type)))].join(', ')}.</p>}
      {incoming.alreadyImported ? <p role="status">This return has already been imported. Opening the same file will not apply it again, including after Undo.</p> : <>
        <p>{plan.addedThreads} new, {plan.changedThreads} changed and {plan.removedThreads} removed discussions.</p>
        {plan.removedThreads > 0 && <p className="text-warning">This return removes discussions that were unchanged in the current draft. Review the proposed result before importing.</p>}
        <Proposals proposals={incoming.proposals} label="Returned suggested replacements" />
        {incoming.proposals.length > 0 && <p>These replacements are imported as pending suggestions. Review each one in Suggested edits for this review; importing feedback does not apply its text.</p>}
        <Discussions comments={incoming.comments} label="Returned discussions" target={id => reviewReturnTargetLabel(incoming, id)} />
        <Discussions comments={plan.comments} label="Proposed discussions" target={id => reviewReturnTargetLabel(incoming, id)} />
        {plan.conflicts.map((conflict, index) => <fieldset key={conflict.id} className="space-y-2 rounded-md border p-3">
          <legend className="font-medium">Conflict {index + 1}: {reviewReturnTargetLabel(incoming, conflict.threadId)} · {conflict.kind === 'resolution' ? 'discussion status' : conflict.kind === 'message' ? 'message edit' : 'edited or removed discussion'}</legend>
          <div className="grid min-w-0 gap-3 sm:grid-cols-3">{(['baseline', 'current', 'returned'] as const).map(version => <div key={version} className="min-w-0 space-y-1">
            <h5 className="font-medium">{version === 'baseline' ? 'Reviewed baseline' : version === 'current' ? 'Current draft' : 'Returned feedback'}</h5>
            <div role="region" aria-label={`Conflict ${index + 1} ${version}`} tabIndex={0} className={regionClass}><DiscussionValue value={conflict[version]} /></div>
          </div>)}</div>
          <div className="flex flex-wrap gap-3">{(['current', 'returned'] as const).map(value => <Label key={value} className="flex items-center gap-2">
            <input type="radio" name={`review-conflict-${index}`} value={value} checked={choices[conflict.id] === value}
              disabled={working || finished || pendingSave || outdated} onChange={() => choose(conflict.id, value)} />
            {value === 'current' ? 'Keep current' : 'Use returned'}
          </Label>)}</div>
        </fieldset>)}
        {!finished && !pendingSave && <Button disabled={working || outdated || plan.status !== 'ready'} onClick={() => void run(async () => {
          const result = await applyReviewReturn(incoming, choices);
          if (!active.current) return;
          if (result === 'committed' || result === 'already-imported') { setFinished(true);announce('Feedback imported. Review pending replacements separately. Undo restores the previous discussions; imported suggestions and the return receipt remain recorded.'); }
          else if (result === 'pending') { setPendingSave(true);announce('Feedback is in this draft but is not saved yet. Retry Save before closing or exporting.'); }
          else { setOutdated(true);throw new Error('The draft changed. Review this return against the current draft again.'); }
        })}>Import reviewed feedback</Button>}
        {pendingSave && <Button disabled={working} onClick={() => void run(async () => {
          await flushPendingReviewWrites(documentId ?? undefined);if (active.current) { setPendingSave(false);setFinished(true);announce('Review feedback committed to its document.'); }
        })}>Retry feedback save</Button>}
      </>}
    </div>}
    {incoming && !finished && !pendingSave && <Button variant="ghost" disabled={working} onClick={() => {
      setIncoming(null);setIncomingValue(null);setPlan(null);setChoices({});setOutdated(false);setError('');
    }}>Cancel feedback import</Button>}
    {incomingValue !== null && !finished && !pendingSave && <Button variant="ghost" disabled={working} onClick={() => void run(() => inspect(incomingValue))}>Review against current draft again</Button>}
    {busy && <p role="status" className="text-sm">Checking or saving feedback…</p>}
  </section>;
}
