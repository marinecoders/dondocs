import { useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDocumentStore } from '@/stores/documentStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { captureDocumentTarget, isCurrentDocumentTarget, useDocumentsStore, type DocumentTarget } from '@/stores/documentsStore';
import { COMMENT_LIMITS, type CommentThread } from '@/lib/reviewComments';
import { availableCommentFields, availableCommentParagraphs, describeCommentAnchor, supportsReviewComments } from '@/lib/reviewCommentTargets';
import { applyCommentMutation, reviewCommentMutation, type CommentMutation } from '@/lib/reviewCommentActions';

type Editor = { kind: 'add' } | { kind: 'reply'; threadId: string } | { kind: 'edit'; threadId: string; messageId: string; text: string };

export function DocumentComments() {
  const category = useDocumentStore(state => state.documentCategory);
  const docType = useDocumentStore(state => state.docType);
  const comments = useDocumentStore(state => state.reviewComments);
  const documentId = useDocumentsStore(state => state.currentId);
  const epoch = useDocumentsStore(state => state.activationEpoch);
  const [open, setOpen] = useState(false);
  if (!documentId || !supportsReviewComments({ documentCategory: category, docType, formData: {} })) return null;
  const count = comments?.threads.filter(thread => !thread.resolved).length ?? 0;
  return <div className="shrink-0 border-b border-border/40 px-4 py-2">
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><MessageSquare className="h-4 w-4" />Comments{count ? ` (${count})` : ''}</Button>
    {open && <CommentsDialog key={`${documentId}:${epoch}`} onClose={() => setOpen(false)} />}
  </div>;
}

export function CommentsDialog({ onClose, initialParagraphId }: { onClose: () => void; initialParagraphId?: string }) {
  const state = useDocumentStore();
  const viewTarget = captureDocumentTarget();
  const [showResolved, setShowResolved] = useState(false);
  const [editor, setEditor] = useState<Editor>({ kind: 'add' });
  const [editorKey, setEditorKey] = useState(0);
  const [feedback, setFeedback] = useState('');
  const result = useRef<HTMLParagraphElement>(null);
  const navigation = useRef<{ paragraphId: string; target: DocumentTarget | null } | null>(null);
  const threads = state.reviewComments?.threads ?? [];
  const startEditor = (next: Editor) => { setEditor(next);setEditorKey(value => value + 1);setFeedback(''); };
  const run = (mutation: CommentMutation, target: DocumentTarget | null): boolean => {
    const outcome = applyCommentMutation(reviewCommentMutation(mutation, target));
    setFeedback(outcome === 'applied' ? 'Comment changes saved. Use Undo to restore the previous state.'
      : outcome === 'stale' ? 'The draft changed. Review the current target before saving your comment.'
        : 'The comment could not be saved. Check the author, text limits, and target.');
    if (outcome === 'applied') requestAnimationFrame(() => result.current?.focus({ preventScroll: true }));
    return outcome === 'applied';
  };
  const visible = threads.filter(thread => thread.resolved === showResolved);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-2xl" onCloseAutoFocus={event => {
      const next = navigation.current;
      if (!next || !isCurrentDocumentTarget(next.target)) return;
      event.preventDefault();
      // The body can still be hidden in the One section editor layout.
      useEditorOutlineStore.getState().jump('body');
      requestAnimationFrame(() => {
        if (!isCurrentDocumentTarget(next.target)) return;
        const row = [...document.querySelectorAll<HTMLElement>('[data-paragraph-id]')].find(element => element.dataset.paragraphId === next.paragraphId);
        row?.querySelector<HTMLElement>('[role="textbox"]')?.focus();
      });
    }}>
      <DialogHeader>
        <DialogTitle>Document comments</DialogTitle>
        <DialogDescription>Comments travel with drafts and shared copies. Clean PDF and Word exports omit them. Reviewer names are self-entered.</DialogDescription>
      </DialogHeader>
      <p ref={result} role="status" tabIndex={-1} className={feedback ? 'text-sm text-muted-foreground' : 'sr-only'}>{feedback}</p>
      <CommentEditor key={editorKey} editor={editor} initialParagraphId={initialParagraphId} onCancel={() => startEditor({ kind: 'add' })} onSave={(mutation, target) => {
        const saved = run(mutation, target);
        if (saved) { setEditor({ kind: 'add' });setEditorKey(value => value + 1); }
        return saved;
      }} />
      <div className="flex flex-wrap gap-2" aria-label="Comment status">
        <Button type="button" size="sm" variant={!showResolved ? 'secondary' : 'outline'} aria-pressed={!showResolved} onClick={() => setShowResolved(false)}>Open ({threads.filter(thread => !thread.resolved).length})</Button>
        <Button type="button" size="sm" variant={showResolved ? 'secondary' : 'outline'} aria-pressed={showResolved} onClick={() => setShowResolved(true)}>Resolved ({threads.filter(thread => thread.resolved).length})</Button>
      </div>
      {visible.length === 0 && <p className="text-sm text-muted-foreground">No {showResolved ? 'resolved' : 'open'} comments.</p>}
      {visible.map(thread => <CommentThreadView key={thread.id} thread={thread} run={mutation => run(mutation, viewTarget)} startEditor={startEditor} onNavigate={paragraphId => {
        navigation.current = { paragraphId, target: captureDocumentTarget() };
        onClose();
      }} />)}
      <Button type="button" variant="outline" onClick={onClose}>Close comments</Button>
    </DialogContent>
  </Dialog>;
}

function CommentEditor({ editor, initialParagraphId, onCancel, onSave }: {
  editor: Editor; initialParagraphId?: string; onCancel: () => void; onSave: (mutation: CommentMutation, target: DocumentTarget | null) => boolean;
}) {
  const state = useDocumentStore();
  const fields = availableCommentFields(state);
  const paragraphs = availableCommentParagraphs(state);
  const [target, setTarget] = useState(captureDocumentTarget);
  const [field, setField] = useState(initialParagraphId ? `paragraph:${initialParagraphId}` : 'document');
  const [author, setAuthor] = useState('');
  const [text, setText] = useState(editor.kind === 'edit' ? editor.text : '');
  const stale = !!text && !isCurrentDocumentTarget(target);
  const paragraphId = field.startsWith('paragraph:') ? field.slice('paragraph:'.length) : undefined;
  const selectedField = field === 'document' || paragraphId !== undefined ? undefined : fields.find(item => item.field === field);
  const unavailableField = field !== 'document' && paragraphId === undefined && !selectedField;
  const longContext = !!selectedField && selectedField.value.length > COMMENT_LIMITS.context;
  const unavailable = paragraphId !== undefined && !paragraphs.some(paragraph => paragraph.paragraphId === paragraphId);
  return <form className="min-w-0 space-y-3 rounded-md border border-border p-3" onSubmit={event => {
    event.preventDefault();
    const mutation: CommentMutation = editor.kind === 'add' ? { kind: 'add', ...(field === 'document' ? {} : paragraphId ? { paragraphId } : { field }), author, text }
      : editor.kind === 'reply' ? { kind: 'reply', threadId: editor.threadId, author, text }
        : { kind: 'edit', threadId: editor.threadId, messageId: editor.messageId, text };
    onSave(mutation, target);
  }}>
    <h3 className="text-sm font-medium">{editor.kind === 'add' ? 'Add a comment' : editor.kind === 'reply' ? 'Reply to comment' : 'Edit comment'}</h3>
    {stale && <div role="alert" className="space-y-2 text-sm">
      <p>The draft changed while this form was open. Your comment text is still here.</p>
      <Button type="button" size="sm" variant="outline" onClick={() => setTarget(captureDocumentTarget())}>Use current draft</Button>
    </div>}
    {editor.kind === 'add' && <div className="space-y-1">
      <Label htmlFor="comment-target">Comment on</Label>
      <select id="comment-target" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={field} onChange={event => setField(event.target.value)}>
        <option value="document">Whole document</option>
        {unavailableField && <option value={field} disabled>Unavailable field: {field}</option>}
        {fields.map(item => <option key={item.field} value={item.field}>{item.label}</option>)}
        {paragraphs.map(item => <option key={item.paragraphId} value={`paragraph:${item.paragraphId}`}>{item.label}</option>)}
        {unavailable && <option value={field} disabled>Unavailable paragraph</option>}
      </select>
      {selectedField && <div className="text-xs text-muted-foreground"><p>Current field value</p><p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words">{selectedField.value || '(Empty)'}</p></div>}
      {unavailableField && <p className="text-sm text-destructive">Choose an available field or the whole document.</p>}
      {longContext && <p className="text-sm text-destructive">This field is too long to capture in a comment. Choose the whole document instead.</p>}
      {unavailable && <p role="alert" className="text-sm text-destructive">This paragraph is unavailable or too long for a paragraph comment. Your text is preserved; choose another target to continue.</p>}
      {paragraphId && !unavailable && <div className="max-h-36 overflow-auto text-xs text-muted-foreground"><p className="font-medium">Current paragraph</p><p className="whitespace-pre-wrap break-words">{paragraphs.find(paragraph => paragraph.paragraphId === paragraphId)?.value || '(Empty)'}</p></div>}
    </div>}
    {editor.kind !== 'edit' && <div className="space-y-1"><Label htmlFor="comment-author">Reviewer name</Label><Input id="comment-author" value={author} maxLength={COMMENT_LIMITS.author} onChange={event => setAuthor(event.target.value)} autoComplete="off" /></div>}
    <div className="space-y-1"><Label htmlFor="comment-text">{editor.kind === 'reply' ? 'Reply' : 'Comment'}</Label><Textarea id="comment-text" autoFocus={editor.kind !== 'add'} value={text} maxLength={COMMENT_LIMITS.text} onChange={event => { if (!text) setTarget(captureDocumentTarget());setText(event.target.value); }} className="min-h-24" /></div>
    <div className="flex flex-wrap gap-2">
      <Button type="submit" size="sm" disabled={stale || editor.kind === 'add' && (unavailableField || longContext || unavailable) || !text.trim() || editor.kind !== 'edit' && !author.trim() || editor.kind === 'edit' && text === editor.text}>{editor.kind === 'edit' ? 'Save comment' : editor.kind === 'reply' ? 'Post reply' : 'Post comment'}</Button>
      {editor.kind !== 'add' && <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel edit</Button>}
    </div>
  </form>;
}

function CommentThreadView({ thread, run, startEditor, onNavigate }: {
  thread: CommentThread; run: (mutation: CommentMutation) => boolean; startEditor: (editor: Editor) => void; onNavigate: (paragraphId: string) => void;
}) {
  const state = useDocumentStore();
  const anchor = describeCommentAnchor(state, thread.anchor);
  return <article className="min-w-0 space-y-3 rounded-md border border-border p-3" aria-label={`Comment on ${anchor.label}`}>
    <h3 className="text-sm font-medium">{anchor.label}</h3>
    {thread.anchor.kind === 'paragraph' && anchor.status !== 'unavailable' && <Button type="button" size="sm" variant="outline" onClick={() => {
      if (thread.anchor.kind === 'paragraph') onNavigate(thread.anchor.paragraphId);
    }}>Go to paragraph</Button>}
    {anchor.status !== 'current' && <p className="text-sm text-amber-700 dark:text-amber-400">{thread.anchor.kind === 'paragraph'
      ? anchor.status === 'changed' ? 'This paragraph’s text or markings changed after the comment was added.' : 'This paragraph was deleted or is unavailable. Its earlier context is kept below.'
      : anchor.status === 'changed' ? 'This field or document format changed after the comment was added.' : 'This field is unavailable in the current document.'}</p>}
    {anchor.context !== undefined && <details className="text-xs text-muted-foreground"><summary>{thread.anchor.kind === 'paragraph' ? 'Paragraph context' : 'Field context'}</summary><dl className="mt-2 space-y-2 break-words">
      <div><dt>When commented</dt><dd className="whitespace-pre-wrap">{anchor.context || '(Empty)'}</dd></div>
      {anchor.current !== undefined && <div><dt>Current value</dt><dd className="whitespace-pre-wrap">{anchor.current || '(Empty)'}</dd></div>}
    </dl></details>}
    {thread.messages.map((message, index) => <div key={message.id} className="space-y-1 border-t border-border/50 pt-2 text-sm">
      <p className="font-medium break-words">{message.author} <span className="font-normal text-xs text-muted-foreground">{new Date(message.createdAt).toLocaleString()}{message.editedAt ? ' (edited)' : ''}</span></p>
      <p className="whitespace-pre-wrap break-words">{message.text}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" aria-label={`Edit ${index === 0 ? 'comment' : 'reply'} by ${message.author}`} onClick={() => startEditor({ kind: 'edit', threadId: thread.id, messageId: message.id, text: message.text })}>Edit</Button>
        {index > 0 && <Button type="button" size="sm" variant="ghost" aria-label={`Delete reply by ${message.author}`} onClick={() => run({ kind: 'delete-reply', threadId: thread.id, messageId: message.id })}>Delete reply</Button>}
      </div>
    </div>)}
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => startEditor({ kind: 'reply', threadId: thread.id })}>Reply</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => run({ kind: 'resolve', threadId: thread.id, resolved: !thread.resolved })}>{thread.resolved ? 'Reopen' : 'Resolve'}</Button>
      <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => run({ kind: 'delete', threadId: thread.id })}>Delete thread</Button>
    </div>
  </article>;
}
