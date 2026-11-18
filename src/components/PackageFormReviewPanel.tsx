import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { PackageMember, PackageMemberReview } from '@/lib/actionPackages';
import { addPackageFormComment, capturePackageFormAnchor, packageFormReviewFields, type PackageFormReview } from '@/lib/packageFormReview';
import { packageBindingTargetKey, type PackageBindingField } from '@/lib/packageBindingTargets';
import { FeedbackCategorySelect } from './FeedbackCategorySelect';
import type { FeedbackCategory } from '@/lib/reviewFeedback';
const input = 'mt-1 block w-full min-w-0 rounded border bg-background p-2 text-sm';
const button = 'h-auto min-h-9 max-w-full whitespace-normal';
const valueText = (value: PackageBindingField['value']) => value === null ? 'Unanswered' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : value || '(Empty text)';

/** The selected form and immutable package review binding supply all field context. */
export function PackageFormReviewPanel({ member, child, busy, onSave, onDraftChange }: {
  member: PackageMember; child: PackageMemberReview; busy: boolean;
  onSave(value: PackageFormReview): Promise<boolean>; onDraftChange?(dirty: boolean): void;
}) {
  const [fields, setFields] = useState<PackageBindingField[]>([]), [target, setTarget] = useState('');
  const [author, setAuthor] = useState(''), [text, setText] = useState(''), [category, setCategory] = useState<FeedbackCategory>('question');
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [pending, setPending] = useState(false);
  const alive = useRef(true), dirty = !!text, callback = useRef(onDraftChange);
  useEffect(() => { callback.current = onDraftChange; }, [onDraftChange]);
  useEffect(() => { callback.current?.(dirty); }, [dirty]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; callback.current?.(false); }; }, []);
  useEffect(() => {
    let current = true;
    void packageFormReviewFields(member).then(value => { if (current) { setFields(value); setLoading(false); } })
      .catch(cause => { if (current) { setError(cause instanceof Error ? cause.message : 'The captured form fields could not be read.'); setLoading(false); } });
    return () => { current = false; };
  }, [member]);
  const selected = fields.find(field => packageBindingTargetKey(field.target) === target), locked = busy || pending || loading;
  return <section aria-label="Captured form field feedback" className="min-w-0 space-y-3 rounded border p-2 sm:p-3">
    <h4 className="font-medium">Form field review</h4>
    <p className="text-xs text-muted-foreground">Comments retain the reviewed field, answer, pinned definition and stable row identity. Reordering rows does not change their target.</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {loading && <p role="status">Reading captured form fields…</p>}
    {!loading && !fields.length && <p className="text-sm">This captured form has no supported scalar fields for precise feedback.</p>}
    <fieldset disabled={locked} className="min-w-0 space-y-2">
      <label className="block text-sm">Form field<select aria-label="Reviewed form field" className={input} disabled={!!text} value={target} onChange={event => setTarget(event.target.value)}>
        <option value="">Choose an exact field or row</option>{fields.map(field => <option key={packageBindingTargetKey(field.target)} value={packageBindingTargetKey(field.target)}>{field.label}</option>)}
      </select></label>
      {selected && <p className="whitespace-pre-wrap break-words text-sm">Reviewed answer: {valueText(selected.value)}</p>}
      <label className="block text-sm">Reviewer name<input aria-label="Form comment reviewer name" className={input} value={author} maxLength={100} onChange={event => setAuthor(event.target.value)} /></label>
      <FeedbackCategorySelect label="Form comment category" value={category} onChange={setCategory} />
      <label className="block text-sm">Comment<textarea aria-label="Form field comment" className={input} value={text} maxLength={10000} rows={3} onChange={event => setText(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Button className={button} disabled={!selected || !author.trim() || !text.trim()} onClick={() => {
        if (!selected || pending) return;
        setPending(true); setError('');
        void capturePackageFormAnchor(member, selected.target).then(anchor => onSave(addPackageFormComment(child.fieldReview, anchor, author, text, category)))
          .then(saved => { if (alive.current && saved) setText(''); })
          .catch(cause => { if (alive.current) setError(cause instanceof Error ? cause.message : 'The form comment could not be saved.'); })
          .finally(() => { if (alive.current) setPending(false); });
      }}>Post form field comment</Button>
        <Button className={button} variant="outline" disabled={!dirty} onClick={() => setText('')}>Cancel form comment</Button></div>
    </fieldset>
    {(child.fieldReview?.comments ?? []).map(comment => <article key={comment.id} className="min-w-0 space-y-2 rounded border p-2 text-sm">
      <p className="break-words font-medium">{comment.anchor.label} · {comment.resolved ? 'Resolved' : 'Open'}</p>
      <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">Reviewed answer: {valueText(comment.anchor.context)}</p>
      {comment.messages.map(message => <p key={message.id} className="whitespace-pre-wrap break-words"><strong>{message.author}: </strong>{message.text}</p>)}
      <Button className={button} variant="outline" disabled={locked || dirty} onClick={() => void onSave({ ...child.fieldReview!, comments: child.fieldReview!.comments.map(item => item.id === comment.id ? { ...item, resolved: !item.resolved } : item) }).catch(cause => { if (alive.current) setError(cause instanceof Error ? cause.message : 'The comment could not be saved.'); })}>{comment.resolved ? 'Reopen form comment' : 'Resolve form comment'}</Button>
    </article>)}
  </section>;
}
