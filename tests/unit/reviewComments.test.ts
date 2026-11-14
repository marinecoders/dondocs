import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { availableCommentFields, captureCommentAnchor, describeCommentAnchor } from '@/lib/reviewCommentTargets';
import { applyCommentMutation, reviewCommentMutation, type CommentMutation } from '@/lib/reviewCommentActions';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore, captureDocumentScope, changeDocumentHistory, captureDocumentTarget } from '@/stores/documentsStore';
import { parseSavedSession } from '@/lib/savedSession';
import { createSharedPayload, parseSharedSession } from '@/lib/sharedSession';
import { documentTextFields } from '@/lib/documentFields';
import { planFirstCitationOrder } from '@/lib/referenceCitations';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Original subject');
});
function mutate(mutation: CommentMutation) { return applyCommentMutation(reviewCommentMutation(mutation)); }
function add() {
  expect(mutate({ kind: 'add', field: 'subject', author: 'Chief', text: 'Please check this. 😀\n"Quoted" feedback.' })).toBe('applied');
  return useDocumentStore.getState().reviewComments!.threads[0];
}

describe('document and field comments', () => {
  it('captures semantic field context and shows changed or unavailable targets', () => {
    const thread = add();
    expect(thread.anchor).toEqual({ kind: 'field', field: 'subject', context: 'Original subject', docType: 'naval_letter' });
    expect(describeCommentAnchor(useDocumentStore.getState(), thread.anchor).status).toBe('current');
    useDocumentStore.getState().setField('subject', 'Later subject');
    expect(describeCommentAnchor(useDocumentStore.getState(), thread.anchor).status).toBe('changed');
    expect(describeCommentAnchor(useDocumentStore.getState(), { ...thread.anchor, kind: 'field', field: 'removedField', context: 'Old', docType: 'naval_letter' }).status).toBe('unavailable');
    expect(captureCommentAnchor(useDocumentStore.getState(), '__proto__')).toBeNull();
    expect(captureCommentAnchor(useDocumentStore.getState(), 'constructor')).toBeNull();
    expect(availableCommentFields(useDocumentStore.getState()).some(field => field.field === 'subject')).toBe(true);
  });
  it('adds, replies, edits, deletes replies, resolves, reopens and deletes whole threads', () => {
    const thread = add();
    expect(mutate({ kind: 'reply', threadId: thread.id, author: 'Drafter', text: 'Updated.' })).toBe('applied');
    const reply = useDocumentStore.getState().reviewComments!.threads[0].messages[1];
    expect(mutate({ kind: 'edit', threadId: thread.id, messageId: reply.id, text: 'Updated today.' })).toBe('applied');
    expect(mutate({ kind: 'resolve', threadId: thread.id, resolved: true })).toBe('applied');
    expect(useDocumentStore.getState().reviewComments!.threads[0].resolved).toBe(true);
    expect(mutate({ kind: 'resolve', threadId: thread.id, resolved: false })).toBe('applied');
    expect(mutate({ kind: 'delete-reply', threadId: thread.id, messageId: reply.id })).toBe('applied');
    expect(mutate({ kind: 'delete-reply', threadId: thread.id, messageId: thread.messages[0].id })).toBe('invalid');
    expect(mutate({ kind: 'delete', threadId: thread.id })).toBe('applied');
    expect(useDocumentStore.getState().reviewComments).toBeUndefined();
  });
  it('makes each comment action one Undo step and retains preceding typing', () => {
    const before = useDocumentStore.getState().getSnapshot();
    add();
    const after = useDocumentStore.getState().getSnapshot();
    const scope = captureDocumentScope();
    expect(changeDocumentHistory('undo', scope)).toBe('applied');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    expect(changeDocumentHistory('redo', scope)).toBe('applied');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(after);
  });
  it('does not create an edited timestamp or history step for unchanged text', () => {
    const thread = add();
    const before = useDocumentStore.getState().getSnapshot();
    expect(mutate({ kind: 'edit', threadId: thread.id, messageId: thread.messages[0].id, text: thread.messages[0].text })).toBe('invalid');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');
    expect(useDocumentStore.getState().reviewComments).toBeUndefined();
  });
  it.each(['typing', 'switch', 'reset'] as const)('rejects pending comments after %s', action => {
    const request = reviewCommentMutation({ kind: 'add', author: 'Chief', text: 'Old draft' });
    if (action === 'typing') useDocumentStore.getState().setField('subject', 'Changed');
    if (action === 'switch') useDocumentsStore.getState().newDocument();
    if (action === 'reset') useDocumentStore.getState().resetForm();
    const before = useDocumentStore.getState().getSnapshot();
    expect(applyCommentMutation(request)).toBe('stale');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
  });
  it('rejects forged requests, repeated application and malformed comment content', () => {
    const request = reviewCommentMutation({ kind: 'add', author: 'Chief', text: 'Check' });
    expect(applyCommentMutation({ ...request })).toBe('stale');
    expect(applyCommentMutation(request)).toBe('applied');
    expect(applyCommentMutation(request)).toBe('stale');
    expect(mutate({ kind: 'add', author: '', text: 'Check' })).toBe('invalid');
    expect(mutate({ kind: 'add', author: 'Chief', text: ' '.repeat(20) })).toBe('invalid');
    expect(mutate({ kind: 'add', author: 'Chief', text: 'x'.repeat(10_001) })).toBe('invalid');
    expect(reviewCommentMutation({ kind: 'add', author: 'Chief', text: 'Check' }, captureDocumentTarget())).toBeTruthy();
  });
  it('round-trips optional notes through saved sessions and versioned shares', () => {
    expect(createSharedPayload(getSerializedSession()).version).toBe(1);
    add();
    const session = getSerializedSession();
    expect(parseSavedSession(session).reviewComments).toEqual(session.reviewComments);
    const shared = createSharedPayload(session);
    expect(shared.version).toBe(2);
    expect(() => parseSharedSession({ ...shared, version: 1 })).toThrow('Comments require');
    expect(parseSharedSession(shared).reviewComments).toEqual(session.reviewComments);
    expect(() => parseSharedSession({ ...shared, reviewComments: { version: 3, threads: [] } })).toThrow();
    const malformed = structuredClone(shared);
    malformed.reviewComments!.threads[0].messages.push(malformed.reviewComments!.threads[0].messages[0]);
    expect(() => parseSavedSession(malformed)).toThrow();
  });
  it('includes review text in transfer/search scans and excludes clean output/substitution', () => {
    add();
    const state = useDocumentStore.getState();
    for (const projection of ['draft', 'share', 'backup', 'search'] as const) {
      expect(documentTextFields(state, projection).some(field => field.path[0] === 'reviewComments' && field.text.includes('Quoted'))).toBe(true);
    }
    for (const projection of ['output', 'substitution'] as const) expect(documentTextFields(state, projection).some(field => field.path[0] === 'reviewComments')).toBe(false);
  });
  it('never remaps or blocks citations inside comments', () => {
    useDocumentStore.setState({ references: [{ letter: 'a', title: 'Alpha' }, { letter: 'b', title: 'Bravo' }], paragraphs: [{ text: 'See reference (b), then reference (a).', level: 0 }], copyTos: [], distributions: [] });
    expect(mutate({ kind: 'add', author: 'Chief', text: 'Question about reference (b).' })).toBe('applied');
    const plan = planFirstCitationOrder(useDocumentStore.getState());
    expect(plan.blockers).toEqual([]);
    expect(plan.patch).not.toHaveProperty('reviewComments');
  });
  it('retains review context through same-owner content replacement and clears an explicit reset', () => {
    const thread = add();
    useDocumentStore.getState().loadTemplate({ paragraphs: [{ text: 'Template', level: 0 }], formData: { subject: 'Template subject' } });
    expect(useDocumentStore.getState().reviewComments!.threads[0]).toEqual(thread);
    expect(describeCommentAnchor(useDocumentStore.getState(), thread.anchor).status).toBe('changed');
    useDocumentStore.getState().clearFieldsExceptLetterhead();
    expect(useDocumentStore.getState().reviewComments!.threads[0]).toEqual(thread);
    useDocumentStore.getState().resetForm();
    expect(useDocumentStore.getState().reviewComments).toBeUndefined();
  });
});
