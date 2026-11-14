import { describe, expect, it } from 'vitest';
import { mergeReturnedComments } from '@/lib/reviewCommentMerge';
import type { CommentMessage, CommentThread, ReviewComments } from '@/lib/reviewComments';

const message = (text = 'Original comment'): CommentMessage => ({ id: crypto.randomUUID(), author: 'Example reviewer', text, createdAt: '2026-11-13T00:00:00Z' });
const thread = (): CommentThread => ({ id: crypto.randomUUID(), anchor: { kind: 'paragraph', paragraphId: 'original-paragraph', context: 'Captured text', docType: 'naval_letter' }, messages: [message()], resolved: false });
const comments = (...items: CommentThread[]): ReviewComments => ({ version: 2, threads: structuredClone(items) });

describe('comment-only review return merging', () => {
  it('combines independent replies and retains stable anchors without using paragraph order', () => {
    const base = thread(), local = structuredClone(base), returned = structuredClone(base);
    local.messages.push(message('Author added this while editing the draft.'));
    returned.messages.push(message('Reviewer returned this reply.'));
    const result = mergeReturnedComments(comments(base), comments(local), comments(returned));
    expect(result.status).toBe('ready');
    expect(result.comments?.threads[0].messages.map(item => item.text)).toEqual(['Original comment', 'Author added this while editing the draft.', 'Reviewer returned this reply.']);
    expect(result.comments?.threads[0].anchor).toEqual(base.anchor);
    expect(result.changedThreads).toBe(1);
  });
  it('is idempotent when the same comments are received repeatedly, including new threads', () => {
    const added = thread();
    const first = mergeReturnedComments(undefined, undefined, comments(added));
    const again = mergeReturnedComments(undefined, first.comments, comments(added));
    expect(again.status).toBe('ready');expect(again.comments).toEqual(first.comments);
    expect([again.changedThreads, again.addedThreads, again.removedThreads]).toEqual([0, 0, 0]);
  });
  it('merges a later reply to a reviewer-created thread already received earlier', () => {
    const added = thread(), updated = structuredClone(added);
    updated.messages.push(message('Later feedback'));
    const result = mergeReturnedComments(undefined, comments(added), comments(updated));
    expect(result.status).toBe('ready');expect(result.comments?.threads[0].messages).toEqual(updated.messages);
  });
  it('preserves local deletion when the returned thread is unchanged', () => {
    const base = thread();
    expect(mergeReturnedComments(comments(base), undefined, comments(base))).toMatchObject({ status: 'ready', comments: undefined });
  });
  it('applies a returned deletion only when local feedback is unchanged', () => {
    const base = thread();
    expect(mergeReturnedComments(comments(base), comments(base), undefined)).toMatchObject({ status: 'ready', comments: undefined, removedThreads: 1 });
  });
  it('requires a choice for deletion versus an edited thread', () => {
    const base = thread(), returned = structuredClone(base);returned.messages[0].text = 'Edited by reviewer';
    const pending = mergeReturnedComments(comments(base), undefined, comments(returned));
    expect(pending.status).toBe('conflict');expect(pending.conflicts[0].kind).toBe('thread');
    const chosen = mergeReturnedComments(comments(base), undefined, comments(returned), { [pending.conflicts[0].id]: 'returned' });
    expect(chosen.status).toBe('ready');expect(chosen.comments?.threads).toEqual([returned]);
  });
  it('requires a choice for competing edits to the same message and preserves independent replies', () => {
    const base = thread(), local = structuredClone(base), returned = structuredClone(base);
    local.messages[0].text = 'Local wording';returned.messages[0].text = 'Returned wording';
    returned.messages.push(message('Independent reply'));
    const pending = mergeReturnedComments(comments(base), comments(local), comments(returned));
    expect(pending.status).toBe('conflict');expect(pending.conflicts).toHaveLength(1);
    expect(pending.conflicts[0].kind).toBe('message');
    const keep = mergeReturnedComments(comments(base), comments(local), comments(returned), { [pending.conflicts[0].id]: 'current' });
    expect(keep.status).toBe('ready');expect(keep.comments?.threads[0].messages.map(item => item.text)).toEqual(['Local wording', 'Independent reply']);
  });
  it('surfaces a local resolution made while the reviewer adds feedback', () => {
    const base = thread(), local = structuredClone(base), returned = structuredClone(base);
    local.resolved = true;returned.messages.push(message('A new question'));
    const pending = mergeReturnedComments(comments(base), comments(local), comments(returned));
    expect(pending.status).toBe('conflict');expect(pending.conflicts[0].kind).toBe('resolution');
    const chosen = mergeReturnedComments(comments(base), comments(local), comments(returned), { [pending.conflicts[0].id]: 'returned' });
    expect(chosen.comments?.threads[0]).toMatchObject({ resolved: false, messages: returned.messages });
  });
  it('does not reopen a locally resolved thread when the reviewer made no change', () => {
    const base = thread(), local = structuredClone(base);local.resolved = true;
    expect(mergeReturnedComments(comments(base), comments(local), comments(base))).toMatchObject({ status: 'ready', comments: comments(local) });
  });
  it('keeps a newer local edit when the return contains the original message', () => {
    const base = thread(), local = structuredClone(base);local.messages[0].text = 'Newer local edit';
    expect(mergeReturnedComments(comments(base), comments(local), comments(base)).comments).toEqual(comments(local));
  });
  it('does not invent a conflict for identical wording with different edit clocks', () => {
    const base = thread(), local = structuredClone(base), returned = structuredClone(base);
    local.messages[0].text = returned.messages[0].text = 'Same new wording';
    local.messages[0].editedAt = '2026-11-14T01:00:00Z';returned.messages[0].editedAt = '2026-11-14T02:00:00Z';
    expect(mergeReturnedComments(comments(base), comments(local), comments(returned)).status).toBe('ready');
  });
  it('rejects changing an existing target or replacing its original message identity', () => {
    const base = thread(), changed = structuredClone(base);changed.anchor = { kind: 'document' };
    expect(() => mergeReturnedComments(comments(base), comments(base), comments(changed))).toThrow(/target/);
    changed.anchor = base.anchor;changed.messages[0].id = crypto.randomUUID();
    expect(() => mergeReturnedComments(comments(base), comments(base), comments(changed))).toThrow(/original message/);
  });
  it('rejects changing the recorded author of an existing message', () => {
    const base = thread(), changed = structuredClone(base);changed.messages[0].author = 'Different person';
    expect(() => mergeReturnedComments(comments(base), comments(base), comments(changed))).toThrow(/identity/);
  });
  it('rejects identifier collisions between independently valid inputs', () => {
    const local = thread(), returned = thread();returned.messages[0].id = local.id;
    expect(() => mergeReturnedComments(undefined, comments(local), comments(returned))).toThrow(/identifiers/);
  });
  it('rejects combined limits instead of partially importing feedback', () => {
    const local = Array.from({ length: 60 }, thread), returned = Array.from({ length: 60 }, thread);
    expect(() => mergeReturnedComments(undefined, comments(...local), comments(...returned))).toThrow(/limits/);
  });
  it('owns returned objects and never mutates the three inputs', () => {
    const base = comments(thread()), incoming = comments(thread()), saved = structuredClone([base, incoming]);
    const result = mergeReturnedComments(base, base, incoming);
    result.comments!.threads[0].messages[0].text = 'Changed result';
    expect([base, incoming]).toEqual(saved);
  });
});
