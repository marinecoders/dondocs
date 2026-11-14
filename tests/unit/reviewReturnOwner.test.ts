import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '@/lib/documentsDb';
import {
  applyOwnedReviewReturn, captureDocumentTarget, changeDocumentHistory, captureDocumentScope, commitCurrentDocument,
  flushDocumentWrites, useDocumentsStore,
} from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { useProfileStore } from '@/stores/profileStore';
import { applyCommentMutation, reviewCommentMutation } from '@/lib/reviewCommentActions';
import type { ReviewReturnWrite } from '@/lib/reviewReturns';
import type { ReviewRound } from '@/lib/reviewRounds';
import type { ReviewComments } from '@/lib/reviewComments';

vi.mock('@/lib/documentsDb', async original => {
  const actual = await original<typeof import('@/lib/documentsDb')>();
  return { ...actual, idbApplyReviewReturn: vi.fn(actual.idbApplyReviewReturn) };
});

let operation: ReviewReturnWrite, comments: ReviewComments;
const originalDb = await vi.importActual<typeof db>('@/lib/documentsDb');
const reviewWrite = vi.mocked(db.idbApplyReviewReturn);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  reviewWrite.mockReset().mockImplementation(originalDb.idbApplyReviewReturn);
  sessionStorage.clear();useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('subject', 'Author draft');
  await commitCurrentDocument();
  const id = useDocumentsStore.getState().currentId!, baseline = structuredClone(useDocumentsStore.getState().docs[id].session);
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: baseline.timestamp,
    label: 'Review', sourceDocumentId: id, ownerDocumentId: id, baselineDigest: 'a'.repeat(64), baseline: { ts: baseline.timestamp, session: baseline } };
  expect(await db.idbAddReviewRound(round)).toBe('committed');
  operation = { kind: 'comment-return', round: { id: round.id, baselineDigest: round.baselineDigest, ownerDocumentId: id },
    receipt: { kind: 'dondocs-review-return-receipt', version: 1, roundId: round.id, baselineDigest: round.baselineDigest,
      documentId: id, returnId: `return_${crypto.randomUUID()}`, returnDigest: 'b'.repeat(64), importedAt: Date.now() } };
  comments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Example reviewer', text: 'Returned feedback', createdAt: '2026-11-13T00:00:00Z' }] }] };
});
afterEach(async () => { reviewWrite.mockImplementation(originalDb.idbApplyReviewReturn);await flushDocumentWrites();vi.clearAllTimers();vi.useRealTimers(); });
const saved = async (id = operation.receipt.documentId) => (await db.idbGetAllDocuments())!.find(record => record.id === id)!;

function holdReview() {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  reviewWrite.mockImplementation(async (...args) => { await waiting;return originalDb.idbApplyReviewReturn(...args); });
  return release;
}

describe('review return owner publication', () => {
  it('retains later body input and local replies while the review transaction waits', async () => {
    const release = holdReview();
    const importing = applyOwnedReviewReturn(captureDocumentTarget(), comments, operation);
    await vi.waitFor(() => expect(reviewWrite).toHaveBeenCalledOnce());
    expect(useDocumentStore.getState().reviewComments).toEqual(comments);expect(useUIStore.getState().saveStatus).not.toBe('saved');
    useDocumentStore.getState().updateParagraph(0, { text: 'Newer author work while feedback saves.' });
    expect(applyCommentMutation(reviewCommentMutation({ kind: 'reply', threadId: comments.threads[0].id, author: 'Drafter', text: 'A newer local reply.' }))).toBe('applied');
    useDocumentsStore.getState().syncCurrent();
    release();expect(await importing).toBe('committed');await flushDocumentWrites();
    const record = await saved();expect(record.session.paragraphs[0].text).toBe('Newer author work while feedback saves.');
    expect(record.session.reviewComments?.threads[0].messages.map(message => message.text)).toEqual(['Returned feedback', 'A newer local reply.']);
    expect(await db.idbReadReviewReturn(operation.round.id, operation.receipt.returnId)).toEqual(operation.receipt);
    expect(useUIStore.getState().saveStatus).toBe('saved');
  });
  it('finishes an accepted operation on its owner without changing another open document or its saved acknowledgement', async () => {
    const release = holdReview();
    const importing = applyOwnedReviewReturn(captureDocumentTarget(), comments, operation);
    await vi.waitFor(() => expect(reviewWrite).toHaveBeenCalledOnce());
    useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('subject', 'Other document');
    const other = useDocumentsStore.getState().currentId!;await commitCurrentDocument();
    const acknowledgement = useUIStore.getState().lastSavedAt;
    release();expect(await importing).toBe('committed');
    expect(useDocumentsStore.getState().currentId).toBe(other);expect(useDocumentStore.getState().reviewComments).toBeUndefined();
    expect(useUIStore.getState().lastSavedAt).toEqual(acknowledgement);expect((await saved()).session.reviewComments).toEqual(comments);
  });
  it('rejects a stale preview before publishing or queueing feedback', async () => {
    const target = captureDocumentTarget();useDocumentStore.getState().setField('subject', 'Changed during review');
    expect(await applyOwnedReviewReturn(target, comments, operation)).toBe('stale');
    expect(reviewWrite).not.toHaveBeenCalled();expect(useDocumentStore.getState().reviewComments).toBeUndefined();
  });
  it('keeps the receipt and feedback pending through a failed commit and a later autosave', async () => {
    reviewWrite.mockResolvedValue('failed');
    expect(await applyOwnedReviewReturn(captureDocumentTarget(), comments, operation)).toBe('pending');
    expect(useDocumentStore.getState().reviewComments).toEqual(comments);expect(useUIStore.getState().saveStatus).not.toBe('saved');
    expect(await db.idbReadReviewReturn(operation.round.id, operation.receipt.returnId)).toBeNull();
    reviewWrite.mockImplementation(originalDb.idbApplyReviewReturn);
    useDocumentStore.getState().setField('subject', 'Later work after failed save');useDocumentsStore.getState().syncCurrent();
    await flushDocumentWrites();
    const record = await saved();expect(record.session.formData.subject).toBe('Later work after failed save');expect(record.session.reviewComments).toEqual(comments);
    expect(await db.idbReadReviewReturn(operation.round.id, operation.receipt.returnId)).toEqual(operation.receipt);
  });
  it('keeps Undo after an in-flight import as a later write while preserving the committed receipt', async () => {
    const release = holdReview();
    const importing = applyOwnedReviewReturn(captureDocumentTarget(), comments, operation);
    await vi.waitFor(() => expect(reviewWrite).toHaveBeenCalledOnce());
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');expect(useDocumentStore.getState().reviewComments).toBeUndefined();
    useDocumentsStore.getState().syncCurrent();release();expect(await importing).toBe('committed');await flushDocumentWrites();
    expect((await saved()).session.reviewComments).toBeUndefined();expect(await db.idbReadReviewReturn(operation.round.id, operation.receipt.returnId)).toEqual(operation.receipt);
  });
});
