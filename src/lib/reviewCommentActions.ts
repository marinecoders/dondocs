import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, isCurrentDocumentTarget, recordDocumentHistory, type DocumentTarget } from '@/stores/documentsStore';
import { captureCommentAnchor, supportsReviewComments } from './reviewCommentTargets';
import { reviewCommentsSchema, type CommentMessage, type ReviewComments } from './reviewComments';

export type CommentMutation =
  | { kind: 'add'; field?: string; paragraphId?: string; author: string; text: string }
  | { kind: 'reply'; threadId: string; author: string; text: string }
  | { kind: 'edit'; threadId: string; messageId: string; text: string }
  | { kind: 'delete-reply'; threadId: string; messageId: string }
  | { kind: 'delete'; threadId: string }
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
  const next: ReviewComments = structuredClone(state.reviewComments ?? { version: 1, threads: [] });
  const newMessage = (author: string, text: string): CommentMessage => ({ id: crypto.randomUUID(), author, text, createdAt: new Date().toISOString() });
  if (mutation.kind === 'add') {
    const anchor = captureCommentAnchor(state, mutation.field, mutation.paragraphId);
    if (!anchor) return 'invalid';
    next.threads.push({ id: crypto.randomUUID(), anchor, messages: [newMessage(mutation.author, mutation.text)], resolved: false });
  } else {
    const thread = next.threads.find(item => item.id === mutation.threadId);
    if (!thread) return 'invalid';
    if (mutation.kind === 'delete') next.threads = next.threads.filter(item => item !== thread);
    else if (mutation.kind === 'resolve') thread.resolved = mutation.resolved;
    else if (mutation.kind === 'reply') thread.messages.push(newMessage(mutation.author, mutation.text));
    else {
      const index = thread.messages.findIndex(message => message.id === mutation.messageId);
      if (index < 0 || mutation.kind === 'delete-reply' && index === 0) return 'invalid';
      if (mutation.kind === 'edit' && thread.messages[index].text === mutation.text) return 'invalid';
      if (mutation.kind === 'delete-reply') thread.messages.splice(index, 1);
      else thread.messages[index] = { ...thread.messages[index], text: mutation.text, editedAt: new Date().toISOString() };
    }
  }
  next.version = next.threads.some(thread => thread.anchor.kind === 'paragraph') ? 2 : 1;
  const parsed = reviewCommentsSchema.safeParse(next);
  if (!parsed.success) return 'invalid';
  if (JSON.stringify(parsed.data) === JSON.stringify(state.reviewComments)) return 'invalid';
  if (!recordDocumentHistory(request.target.scope)) return 'stale';
  issued.delete(request);
  useDocumentStore.setState({ reviewComments: parsed.data.threads.length ? parsed.data : undefined });
  recordDocumentHistory(request.target.scope);
  return 'applied';
}
