import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDocumentStore, getSerializedSession, mutateSessionAssets, saveSessionToStorage, hasSavedSession } from '@/stores/documentStore';
import { useDocumentsStore, captureDocumentScope, changeDocumentHistory, recordDocumentHistory, isMeaningful } from '@/stores/documentsStore';
import { reviewCommentMutation, applyCommentMutation, type CommentMutation } from '@/lib/reviewCommentActions';
import { reviewCommentsSchema, type CommentThread, type ReviewComments } from '@/lib/reviewComments';
import { buildBackup } from '@/lib/backup';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Subject under review');
});

function thread(context = 'Subject under review'): CommentThread {
  return { id: crypto.randomUUID(), anchor: { kind: 'field', field: 'subject', context, docType: 'naval_letter' }, resolved: true,
    messages: [{ id: crypto.randomUUID(), author: 'A', text: 'x', createdAt: '2026-11-13T00:00:00Z' }] };
}
function seed() {
  const value = thread();
  useDocumentStore.setState({ reviewComments: { version: 1, threads: [value] } });
  return value;
}

const changes = {
  mode: () => useDocumentStore.getState().setDocumentMode('custom'),
  format: () => useDocumentStore.getState().setDocType('business_letter'),
  template: () => useDocumentStore.getState().loadTemplate({ formData: { subject: 'Replacement' } }),
  clear: () => useDocumentStore.getState().clearFieldsExceptLetterhead(),
  undo: () => {
    const scope = captureDocumentScope();
    recordDocumentHistory(scope);
    useDocumentStore.getState().setField('subject', 'Later subject');
    recordDocumentHistory(scope);
    expect(changeDocumentHistory('undo', scope)).toBe('applied');
  },
};

describe('review action ownership across editor transitions', () => {
  it.each([false, true])('saves comment-only starter work when leaving the draft (synced first: %s)', sync => {
    useDocumentsStore.getState().newDocument();
    const documentId = useDocumentsStore.getState().currentId!;
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', author: 'Chief', text: 'Please draft the body.' }))).toBe('applied');
    if (sync) {
      useDocumentsStore.getState().syncCurrent();
      expect(useDocumentsStore.getState().docs[documentId]?.session.reviewComments?.threads[0].messages[0].text).toBe('Please draft the body.');
    }
    useDocumentsStore.getState().newDocument();
    expect(useDocumentsStore.getState().docs[documentId]?.session.reviewComments?.threads[0].messages[0].text).toBe('Please draft the body.');
  });

  it('recognizes comment-only legacy recovery content', () => {
    useDocumentStore.setState({ formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [] });
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', author: 'Chief', text: 'Recover this review.' }))).toBe('applied');
    expect(isMeaningful(getSerializedSession())).toBe(true);
    saveSessionToStorage(useDocumentStore.getState());
    expect(hasSavedSession()).toBe(true);
  });

  for (const [transition, change] of Object.entries(changes)) {
    it.each(['reply', 'edit', 'delete', 'resolve'] as const)('rejects a pending %s after '+transition+' without another mutation', kind => {
      const original = seed();
      const mutation: CommentMutation = kind === 'reply' ? { kind, threadId: original.id, author: 'B', text: 'Reply' }
        : kind === 'edit' ? { kind, threadId: original.id, messageId: original.messages[0].id, text: 'Revised comment' }
          : kind === 'resolve' ? { kind, threadId: original.id, resolved: false } : { kind, threadId: original.id };
      const pending = reviewCommentMutation(mutation);
      change();
      const before = useDocumentStore.getState().getSnapshot();
      expect(applyCommentMutation(pending)).toBe('stale');
      expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
    });
  }

  it('owns supplied mutation text and remains usable across equivalent asset hydration', () => {
    const original = seed();
    const mutation: CommentMutation = { kind: 'reply', threadId: original.id, author: 'B', text: 'Reviewed reply' };
    const pending = reviewCommentMutation(mutation);
    mutation.text = 'Unreviewed replacement';
    mutateSessionAssets(() => useDocumentStore.setState(state => ({ formData: { ...state.formData } })));
    expect(applyCommentMutation(pending)).toBe('applied');
    expect(useDocumentStore.getState().reviewComments!.threads[0].messages.at(-1)?.text).toBe('Reviewed reply');
  });
});

describe('bounded review containers', () => {
  it.each([20_000, 20_001])('captures a field context of %i characters completely or rejects it atomically', size => {
    useDocumentStore.getState().setField('subject', 's'.repeat(size));
    const original = useDocumentStore.getState().getSnapshot();
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', field: 'subject', author: 'Chief', text: 'Review the full field.' })))
      .toBe(size === 20_000 ? 'applied' : 'invalid');
    if (size === 20_000) expect(useDocumentStore.getState().reviewComments!.threads[0].anchor).toMatchObject({ context: original.formData.subject });
    else expect(useDocumentStore.getState().getSnapshot()).toEqual(original);
  });

  it('can reply after the current field outgrows its stored context limit', () => {
    useDocumentStore.getState().setField('subject', 's'.repeat(20_000));
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', field: 'subject', author: 'Chief', text: 'Full original context.' }))).toBe('applied');
    const original = useDocumentStore.getState().reviewComments!.threads[0];
    useDocumentStore.getState().setField('subject', 's'.repeat(20_001));
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'reply', threadId: original.id, author: 'Drafter', text: 'The field is now longer.' }))).toBe('applied');
    expect(useDocumentStore.getState().reviewComments!.threads[0].anchor).toEqual(original.anchor);
  });

  it('accepts the exact aggregate text limit and rejects an extra character without changing the document', () => {
    const comments: ReviewComments = { version: 1, threads: Array.from({ length: 10 }, () => thread('c'.repeat(19_998))) };
    expect(reviewCommentsSchema.safeParse(comments).success).toBe(true);
    useDocumentStore.setState({ reviewComments: comments });
    const original = useDocumentStore.getState().getSnapshot();
    const target = comments.threads[0];
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'reply', threadId: target.id, author: 'B', text: 'y' }))).toBe('invalid');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(original);
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'delete', threadId: target.id }))).toBe('applied');
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'reply', threadId: comments.threads[1].id, author: 'B', text: 'Now fits' }))).toBe('applied');
  });

  it('enforces total thread and per-thread reply limits before publishing changes', () => {
    const threads = Array.from({ length: 100 }, () => thread());
    useDocumentStore.setState({ reviewComments: { version: 1, threads } });
    const original = useDocumentStore.getState().getSnapshot();
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', author: 'B', text: 'One thread too many' }))).toBe('invalid');
    expect(useDocumentStore.getState().getSnapshot()).toEqual(original);
    const full = thread();
    full.messages = Array.from({ length: 50 }, () => thread().messages[0]);
    useDocumentStore.setState({ reviewComments: { version: 1, threads: [full] } });
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'reply', threadId: full.id, author: 'B', text: 'One reply too many' }))).toBe('invalid');
    expect(useDocumentStore.getState().reviewComments!.threads[0].messages).toHaveLength(50);
  });

  it('retains the compatible backup boundary when every thread is resolved', async () => {
    const original = seed();
    const documentId = useDocumentsStore.getState().currentId;
    const bundle = JSON.parse(await buildBackup());
    expect(bundle.version).toBe(6);
    expect(bundle.documents.find((record: { id: string }) => record.id === documentId).session.reviewComments.threads)
      .toEqual([original]);
  });
});
