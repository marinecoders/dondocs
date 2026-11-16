import type { DocumentFieldSource } from './documentFields';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget, recordDocumentHistory, type DocumentTarget } from '@/stores/documentsStore';
import { captureCommentAnchor, supportsReviewComments } from './reviewCommentTargets';
import type { FeedbackCategory } from './reviewFeedback';
import { captureTextRange, resolveTextRange, type SelectedTextRange } from './reviewTextRanges';
import { reviewCommentsVersion, reviewCommentsSchema, type CommentMessage, type ReviewComments } from './reviewComments';

export type CommentMutation =
  | { kind: 'add'; field?: string; paragraphId?: string; range?: SelectedTextRange; author: string; text: string; category?: FeedbackCategory }
  | { kind: 'reattach'; threadId: string; range: SelectedTextRange }
  | { kind: 'reply'; threadId: string; author: string; text: string }
  | { kind: 'edit'; threadId: string; messageId: string; text: string }
  | { kind: 'delete-reply'; threadId: string; messageId: string }
  | { kind: 'delete'; threadId: string }
  | { kind: 'classify'; threadId: string; category: FeedbackCategory }
  | { kind: 'resolve'; threadId: string; resolved: boolean };
export interface ReviewedCommentMutation { readonly target: DocumentTarget | null }
const issued = new WeakMap<ReviewedCommentMutation, CommentMutation>();

/** The supplied target is captured when a form or the displayed thread opens. */
export function reviewCommentMutation(mutation: CommentMutation, target: DocumentTarget | null = captureDocumentTarget()): ReviewedCommentMutation {
  const request = Object.freeze({ target });
  issued.set(request, structuredClone(mutation));
  return request;
}

export function applyCommentMutation(request: ReviewedCommentMutation): 'applied' | 'stale' | 'invalid' {
  const mutation = issued.get(request);
  if (!mutation || !isCurrentDocumentTarget(request.target)) return 'stale';
  const state = useDocumentStore.getState();
  if (!supportsReviewComments(state)) return 'invalid';
  const parsed = mutateReviewComments(state.reviewComments, mutation,
    value => captureCommentAnchor(state, value.field, value.paragraphId), state);
  if (!parsed) return 'invalid';
  if (JSON.stringify(parsed) === JSON.stringify(state.reviewComments)) return 'invalid';
  if (!recordDocumentHistory(request.target.scope)) return 'stale';
  issued.delete(request);
  useDocumentStore.setState({ reviewComments: parsed.threads.length ? parsed : undefined });
  recordDocumentHistory(request.target.scope);
  return 'applied';
}

/** Shared pure mutation adapter for package members; persistence belongs to the caller. */
export function mutateReviewComments(comments: ReviewComments | undefined, mutation: CommentMutation,
  anchorFor: (mutation: Extract<CommentMutation, { kind: 'add' }>) => import('./reviewComments').CommentAnchor | null, source?: DocumentFieldSource): ReviewComments | null {
  const next: ReviewComments = structuredClone(comments ?? { version: 1, threads: [] });
  const newMessage = (author: string, text: string): CommentMessage => ({ id: crypto.randomUUID(), author, text, createdAt: new Date().toISOString() });
  if (mutation.kind === 'add') {
    const anchor = mutation.range ? source && !mutation.field && !mutation.paragraphId && mutation.range.start < mutation.range.end
      && resolveTextRange(source, mutation.range).status === 'current'
      && JSON.stringify(captureTextRange(source, mutation.range.paragraphId, mutation.range.start, mutation.range.end)) === JSON.stringify(mutation.range) ? mutation.range : null
      : anchorFor(mutation);
    if (!anchor) return null;
    next.threads.push({ id: crypto.randomUUID(), anchor, messages: [newMessage(mutation.author, mutation.text)], resolved: false, ...(mutation.category ? { category: mutation.category } : {}) });
  } else {
    const thread = next.threads.find(item => item.id === mutation.threadId);
    if (!thread) return null;
    if (mutation.kind === 'reattach') {
      if (!source || thread.anchor.kind !== 'range' || resolveTextRange(source, thread.anchor).status === 'current'
        || !mutation.range || mutation.range.start === mutation.range.end
        || JSON.stringify(captureTextRange(source, mutation.range.paragraphId, mutation.range.start, mutation.range.end)) !== JSON.stringify(mutation.range)) return null;
      thread.anchorHistory = [...(thread.anchorHistory ?? []), { anchor: thread.anchor, reattachedAt: new Date().toISOString() }];
      thread.anchor = mutation.range;
    } else if (mutation.kind === 'delete') next.threads = next.threads.filter(item => item !== thread);
    else if (mutation.kind === 'classify') thread.category = mutation.category;
    else if (mutation.kind === 'resolve') thread.resolved = mutation.resolved;
    else if (mutation.kind === 'reply') thread.messages.push(newMessage(mutation.author, mutation.text));
    else {
      const index = thread.messages.findIndex(message => message.id === mutation.messageId);
      if (index < 0 || mutation.kind === 'delete-reply' && index === 0) return null;
      if (mutation.kind === 'edit' && thread.messages[index].text === mutation.text) return null;
      if (mutation.kind === 'delete-reply') thread.messages.splice(index, 1);
      else thread.messages[index] = { ...thread.messages[index], text: mutation.text, editedAt: new Date().toISOString() };
    }
  }
  next.version = reviewCommentsVersion(next.threads);
  const parsed = reviewCommentsSchema.safeParse(next);
  if (!parsed.success) return null;
  return parsed.data;
}
