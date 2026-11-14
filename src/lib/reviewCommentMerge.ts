import { reviewCommentsSchema, type CommentMessage, type CommentThread, type ReviewComments } from './reviewComments';

export type ReviewReturnChoice = 'current' | 'returned';
export interface ReviewReturnConflict {
  id: string;
  threadId: string;
  messageId?: string;
  kind: 'thread' | 'message' | 'resolution';
  baseline?: CommentThread | CommentMessage | boolean;
  current?: CommentThread | CommentMessage | boolean;
  returned?: CommentThread | CommentMessage | boolean;
  choice?: ReviewReturnChoice;
}
export interface ReviewCommentMerge {
  status: 'ready' | 'conflict';
  comments?: ReviewComments;
  conflicts: ReviewReturnConflict[];
  changedThreads: number;
  addedThreads: number;
  removedThreads: number;
}

const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
// Editing the same wording twice does not become a conflict solely because of clocks.
const messageValue = (message: CommentMessage | undefined) => message && {
  id: message.id, author: message.author, text: message.text, createdAt: message.createdAt,
};
const sameMessage = (a: CommentMessage | undefined, b: CommentMessage | undefined) => equal(messageValue(a), messageValue(b));
const sameThread = (a: CommentThread | undefined, b: CommentThread | undefined) => {
  const value = (thread: CommentThread | undefined) => thread && {
    id: thread.id, anchor: thread.anchor, resolved: thread.resolved, messages: thread.messages.map(messageValue),
  };
  return equal(value(a), value(b));
};
const threads = (value: ReviewComments | undefined) => reviewCommentsSchema.parse(value ?? { version: 2, threads: [] }).threads;
const byId = <T extends { id: string }>(items: readonly T[]) => new Map(items.map(item => [item.id, item]));

/** Merge discussions only. Document text and target identities never come from a return. */
export function mergeReturnedComments(
  baseline: ReviewComments | undefined,
  current: ReviewComments | undefined,
  returned: ReviewComments | undefined,
  choices: Readonly<Record<string, ReviewReturnChoice>> = {},
): ReviewCommentMerge {
  const original = threads(baseline), local = threads(current), incoming = threads(returned);
  const before = byId(original), now = byId(local), received = byId(incoming);
  // Existing controls edit message text and status, never their target or identity.
  for (const thread of incoming) {
    const old = before.get(thread.id);
    if (!old) continue;
    if (!equal(old.anchor, thread.anchor) || old.messages[0].id !== thread.messages[0].id) {
      throw new Error('This return changes an existing comment target or original message. Ask the reviewer to return comments from the original review copy.');
    }
    const oldMessages = byId(old.messages);
    for (const message of thread.messages) {
      const previous = oldMessages.get(message.id);
      if (previous && (message.author !== previous.author || message.createdAt !== previous.createdAt)) {
        throw new Error('This return changes the identity of an existing comment message.');
      }
    }
  }
  const conflicts: ReviewReturnConflict[] = [];
  const choose = <T extends CommentThread | CommentMessage | boolean>(
    kind: ReviewReturnConflict['kind'], threadId: string, base: T | undefined, left: T | undefined,
    right: T | undefined, messageId?: string,
  ): T | undefined => {
    const id = `${threadId}:${kind}${messageId ? `:${messageId}` : ''}`;
    const choice = Object.hasOwn(choices, id) ? choices[id] : undefined;
    if (choice !== undefined && choice !== 'current' && choice !== 'returned') throw new Error('Invalid review conflict choice.');
    conflicts.push({ id, threadId, messageId, kind, baseline: base, current: left, returned: right, choice });
    return choice === 'returned' ? right : left;
  };
  const merged: CommentThread[] = [];
  for (const id of new Set([...before.keys(), ...now.keys(), ...received.keys()])) {
    const base = before.get(id), left = now.get(id), right = received.get(id);
    let next: CommentThread | undefined;
    if (sameThread(left, right)) next = left;
    else if (sameThread(right, base)) next = left;
    else if (sameThread(left, base)) next = right;
    else if (!left || !right || !equal(left.anchor, right.anchor) || left.messages[0].id !== right.messages[0].id) {
      next = choose('thread', id, base, left, right);
    } else {
      const oldMessages = byId(base?.messages ?? []), localMessages = byId(left.messages), returnedMessages = byId(right.messages);
      const messages: CommentMessage[] = [];
      for (const messageId of new Set([...oldMessages.keys(), ...localMessages.keys(), ...returnedMessages.keys()])) {
        const old = oldMessages.get(messageId), a = localMessages.get(messageId), b = returnedMessages.get(messageId);
        let message: CommentMessage | undefined;
        if (sameMessage(a, b)) message = a;
        else if (sameMessage(b, old)) message = a;
        else if (sameMessage(a, old)) message = b;
        else message = choose('message', id, old, a, b, messageId);
        if (message) messages.push(message);
      }
      // A resolution made while the other copy gains feedback needs an explicit decision.
      const resolved = left.resolved === right.resolved ? left.resolved
        : choose('resolution', id, base?.resolved, left.resolved, right.resolved)!;
      next = { ...left, messages, resolved };
    }
    if (next) merged.push(structuredClone(next));
  }
  // Combined inputs can exceed limits or collide even when each input is valid alone.
  const parsed = reviewCommentsSchema.safeParse({ version: merged.some(thread => thread.anchor.kind === 'paragraph') ? 2 : 1, threads: merged });
  if (!parsed.success) throw new Error('The combined comments exceed the supported limits or contain conflicting identifiers. No comments were imported.');
  const result = byId(parsed.data.threads);
  return {
    status: conflicts.some(conflict => !conflict.choice) ? 'conflict' : 'ready',
    comments: parsed.data.threads.length ? parsed.data : undefined,
    conflicts,
    changedThreads: local.filter(thread => result.has(thread.id) && !sameThread(thread, result.get(thread.id))).length,
    addedThreads: parsed.data.threads.filter(thread => !now.has(thread.id)).length,
    removedThreads: local.filter(thread => !result.has(thread.id)).length,
  };
}
