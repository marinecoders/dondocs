import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import type { ActionPackage, PackageMemberReview, PackageReviewRound } from '@/lib/actionPackages';
import { preparePackageReviewMember, savePackageMemberReview } from '@/lib/packageMemberReviews';
import { packageReviewRoundStatus } from '@/lib/packageReviewRounds';
import { ReviewSuggestionsPanel } from './editor/ReviewSuggestionsPanel';
import { appendReviewSuggestions } from '@/lib/reviewSuggestions';
import { mutateReviewComments, type CommentMutation } from '@/lib/reviewCommentActions';
import { availableCommentFields, availableCommentParagraphs, captureCommentAnchor, describeCommentAnchor } from '@/lib/reviewCommentTargets';
import { FeedbackCategorySelect } from './FeedbackCategorySelect';
import type { FeedbackCategory } from '@/lib/reviewFeedback';

/** A package-owned detached view. No document-store activation or autosave occurs. */
export function PackageMemberReviewPanel({ record, round, busy, onChange, run, onDraftChange }: {
  onDraftChange?: (dirty: boolean) => void;
  record: ActionPackage; round: PackageReviewRound; busy: boolean;
  onChange(record: ActionPackage, round: PackageReviewRound): void;
  run(action: () => Promise<void>): Promise<void>;
}) {
  const [typedDirty, setTypedDirty] = useState(false);
  useEffect(() => { onDraftChange?.(typedDirty); return () => onDraftChange?.(false); }, [typedDirty, onDraftChange]);
  useEffect(() => {
    if (!typedDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const guard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k' || event.shiftKey && event.key.toLowerCase() === 't')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', warn); window.addEventListener('keydown', guard, true);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('keydown', guard, true); };
  }, [typedDirty]);
  const [selected, setSelected] = useState('');
  const [history, setHistory] = useState<PackageMemberReview[]>([]), [future, setFuture] = useState<PackageMemberReview[]>([]);
  const member = round.baseline.members.find(member => member.id === selected);
  const child = round.memberReviews?.find(child => child.binding.memberId === selected);
  const alive = useRef(true);
  const view = `${record.id}:${round.id}:${selected}`;
  const currentView = useRef(view);
  useLayoutEffect(() => { currentView.current = view; }, [view]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const disabled = busy || packageReviewRoundStatus(round) !== 'active';
  async function publish(value: PackageMemberReview, remember = true) {
    const next = await savePackageMemberReview(record, round.id, value, undefined, () => alive.current && currentView.current === view);
    if (!alive.current || currentView.current !== view) throw new Error('This package member review is no longer current.');
    if (remember && child) { setHistory(items => [...items, structuredClone(child)]); setFuture([]); }
    onChange(next, next.reviewRounds!.find(value => value.id === round.id)!);
  }
  return <section aria-label="Package member feedback" className="space-y-3 rounded border p-3">
    <h3 className="font-medium">Review captured package members</h3>
    <nav aria-label="Captured review members" className="flex flex-wrap gap-2">
      {round.baseline.members.map(member => <Button key={member.id} variant={selected === member.id ? 'secondary' : 'outline'} disabled={busy || typedDirty}
        onClick={() => void run(async () => {
          if (packageReviewRoundStatus(round) !== 'active') { setSelected(member.id); return; }
          const result = await preparePackageReviewMember(record, round.id, member.id, undefined, () => alive.current && currentView.current === view);
          if (alive.current && currentView.current === view) { onChange(result.record, result.record.reviewRounds!.find(value => value.id === round.id)!); setSelected(member.id); setHistory([]); setFuture([]); }
        })}>{member.label}</Button>)}
    </nav>
    {member && <>
      <h4 className="font-medium break-words">{member.label}</h4>
      {member.kind === 'native' ? <div role="region" aria-label="Captured member text" tabIndex={0} className="max-h-72 overflow-auto space-y-2 whitespace-pre-wrap break-words rounded border p-3 text-sm">
        {availableCommentFields(member.session).map(field => <p key={field.field}><strong>{field.label}: </strong>{field.value}</p>)}
        {member.session.paragraphs.map((paragraph, index) => <p key={paragraph.id ?? index}>{paragraph.text}</p>)}
      </div> : <p className="text-sm">Preserved original PDF · {member.signedOriginal ? 'signed original' : 'original'}. Use Download unchanged original below to inspect its exact pages. Comments do not alter PDF bytes or signatures.</p>}
      {member.kind === 'native' && !child?.nativeRound && <p className="text-xs text-muted-foreground">This captured format supports whole-member comments. Native correspondence supports field and paragraph replacement proposals.</p>}
      {child && <>
        <div className="flex gap-2">
          <Button variant="outline" disabled={disabled || typedDirty || !history.length} onClick={() => void run(async () => {
            const previous = history.at(-1)!; await publish({ ...child, comments: previous.comments }, false); setHistory(items => items.slice(0, -1)); setFuture(items => [...items, structuredClone(child)]);
          })}>Undo member comment</Button>
          <Button variant="outline" disabled={disabled || typedDirty || !future.length} onClick={() => void run(async () => {
            const next = future.at(-1)!; await publish({ ...child, comments: next.comments }, false); setFuture(items => items.slice(0, -1)); setHistory(items => [...items, structuredClone(child)]);
          })}>Redo member comment</Button>
        </div>
        <PackageMemberComments key={`comments:${selected}`} child={child} busy={disabled || typedDirty} onSave={async mutation => {
          let saved = false; await run(async () => {
          const comments = mutateReviewComments(child.comments, mutation, value => child.nativeRound && member.kind === 'native'
            ? captureCommentAnchor(member.session, value.field, value.paragraphId) : value.field || value.paragraphId ? null : { kind: 'document' }, member.kind === 'native' ? member.session : undefined);
          if (!comments) throw new Error('Check the comment text, reviewer name and captured target.');
          await publish({ ...child, comments }); saved = true;
        }); return saved; }} />
        {child.nativeRound && child.suggestions && <ReviewSuggestionsPanel key={`suggestions:${selected}`} onDraftChange={setTypedDirty} round={child.nativeRound} current={child.nativeRound.baseline.session}
          state={child.suggestions} busy={disabled} owner={false} onDecide={async () => false} onCreate={async proposal => {
            let saved = false;
            await run(async () => { await publish({ ...child, suggestions: appendReviewSuggestions(child.nativeRound!, child.suggestions!, [proposal]) }, false); saved = true; });
            return saved;
          }} />}
      </>}
    </>}
  </section>;
}
function PackageMemberComments({ child, busy, onSave }: { child: PackageMemberReview; busy: boolean; onSave(mutation: CommentMutation): Promise<boolean> }) {
  const [target, setTarget] = useState('document'), [author, setAuthor] = useState(''), [text, setText] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('question');
  const [reply, setReply] = useState<string | null>(null);
  const session = child.nativeRound?.baseline.session;
  const fields = session ? availableCommentFields(session) : [], paragraphs = session ? availableCommentParagraphs(session) : [];
  return <section aria-label="Package member comments" className="space-y-3">
    <h4 className="font-medium">Member comments</h4>
    <form className="space-y-2" onSubmit={event => {
      event.preventDefault();
      void onSave(reply ? { kind: 'reply', threadId: reply, author, text } : { kind: 'add', author, text, category,
        ...(target.startsWith('paragraph:') ? { paragraphId: target.slice(10) } : target !== 'document' ? { field: target } : {}) }).then(saved => { if (saved) { setText(''); setReply(null); } });
    }}>
      <fieldset disabled={busy} className="space-y-2">
        <label className="block text-sm">Comment on<select aria-label="Package comment target" value={target} onChange={event => setTarget(event.target.value)} className="w-full rounded border bg-background p-2">
          <option value="document">Whole member</option>
          {fields.map(field => <option key={field.field} value={field.field}>{field.label}</option>)}
          {paragraphs.map(paragraph => <option key={paragraph.paragraphId} value={`paragraph:${paragraph.paragraphId}`}>{paragraph.label}</option>)}
        </select></label>
        <label className="block text-sm">Reviewer name<Input aria-label="Package comment reviewer name" value={author} maxLength={100} onChange={event => setAuthor(event.target.value)} /></label>
        <FeedbackCategorySelect label="Package comment category" value={category} onChange={setCategory} />
        <label className="block text-sm">{reply ? 'Reply' : 'Comment'}<Textarea aria-label="Package member comment" value={text} maxLength={10000} onChange={event => setText(event.target.value)} /></label>
        <Button disabled={!author.trim() || !text.trim()} type="submit">{reply ? 'Post member reply' : 'Post member comment'}</Button>
        {reply && <Button type="button" variant="outline" onClick={() => setReply(null)}>Cancel reply</Button>}
      </fieldset>
    </form>
    {child.comments.threads.map(thread => <article key={thread.id} className="space-y-2 rounded border p-3 text-sm">
      <p className="font-medium">{session ? describeCommentAnchor(session, thread.anchor).label : 'Whole original PDF'} · {thread.resolved ? 'Resolved' : 'Open'}</p>
      {thread.messages.map(message => <div key={message.id}><p className="font-medium break-words">{message.author}</p><p className="whitespace-pre-wrap break-words">{message.text}</p></div>)}
      <Button disabled={busy} variant="outline" onClick={() => setReply(thread.id)}>Reply to member comment</Button>
      <Button disabled={busy} variant="outline" onClick={() => void onSave({ kind: 'resolve', threadId: thread.id, resolved: !thread.resolved })}>{thread.resolved ? 'Reopen member comment' : 'Resolve member comment'}</Button>
    </article>)}
  </section>;
}
