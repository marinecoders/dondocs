import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentWrites, parseDocumentWriteJournal, WRITE_JOURNAL_KEY } from '@/lib/documentWrites';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewReturnWrite } from '@/lib/reviewReturns';
import type { DocumentWriteOutcome, ReviewReturnWriteOutcome, StoredDocument } from '@/lib/documentsDb';

const document = (subject = 'Original'): StoredDocument => ({ id: 'owner', meta: { id: 'owner', title: 'Draft', docType: 'naval_letter', updatedAt: 1 },
  session: { ...createBlankSession(), formData: { subject } } });
const operation = (): ReviewReturnWrite => {
  const roundId = `review_${crypto.randomUUID()}`, baselineDigest = 'a'.repeat(64);
  return { kind: 'comment-return', round: { id: roundId, baselineDigest, ownerDocumentId: 'owner' },
    receipt: { kind: 'dondocs-review-return-receipt', version: 1, roundId, baselineDigest, documentId: 'owner',
      returnId: `return_${crypto.randomUUID()}`, returnDigest: 'b'.repeat(64), importedAt: 100 } };
};
const withComments = (source: StoredDocument): StoredDocument => {
  const result = structuredClone(source);result.meta.updatedAt++;
  result.session.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Example reviewer', text: 'Returned feedback', createdAt: '2026-11-13T00:00:00Z' }] }] };
  return result;
};
const journal = () => parseDocumentWriteJournal(JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!));
beforeEach(() => sessionStorage.clear());

describe('review receipt fences in the existing document writer', () => {
  it('retains receipt-only writes as unsaved work in a downgrade-safe journal', async () => {
    let finish!: (outcome: ReviewReturnWriteOutcome) => void;
    const write = vi.fn().mockResolvedValue('committed');
    const review = vi.fn(() => new Promise<ReviewReturnWriteOutcome>(resolve => { finish = resolve; }));
    const queue = new DocumentWrites(write, () => {}, undefined, review), before = document();
    const revision = queue.enqueueReviewReturn(before, before, operation());
    expect(queue.hasChanges('owner')).toBe(true);expect(queue.hasReviewReturns()).toBe(true);
    expect(queue.status(revision)?.status).toBe('pending');expect(queue.latestReceipt('owner')).toBeUndefined();
    expect(JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!)[0]).toMatchObject({ kind: 'dondocs-review-write', version: 1 });
    expect(journal()[0].reviewReturns).toHaveLength(1);
    finish('committed');expect(await queue.flush()).toBe(true);
    expect(queue.matches(queue.latestReceipt('owner'), before)).toBe(true);expect(write).not.toHaveBeenCalled();
    expect(queue.hasReviewReturns()).toBe(false);expect(sessionStorage.getItem(WRITE_JOURNAL_KEY)).toBeNull();
  });
  it('preserves the import while coalescing newer body edits queued during its transaction', async () => {
    let finish!: (outcome: ReviewReturnWriteOutcome) => void;
    const review = vi.fn(() => new Promise<ReviewReturnWriteOutcome>(resolve => { finish = resolve; }));
    const write = vi.fn().mockResolvedValue('committed');
    const queue = new DocumentWrites(write, () => {}, undefined, review), before = document(), imported = withComments(before);
    queue.enqueueReviewReturn(before, imported, operation());
    let latest = imported;
    for (let index = 0; index < 20; index++) {
      latest = structuredClone(imported);latest.session.formData.subject = `Newer body ${index}`;
      queue.enqueue(imported, latest);
    }
    expect(journal()[0].versions).toHaveLength(2);expect(journal()[0].reviewReturns?.[0].index).toBe(0);
    expect(write).not.toHaveBeenCalled();
    finish('committed');expect(await queue.flush()).toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith(imported, latest);
    expect(latest.session.reviewComments).toEqual(imported.session.reviewComments);
    expect(queue.matches(queue.latestReceipt('owner'), latest)).toBe(true);
  });
  it('keeps every receipt through multiple interleaved fences and index shifts', async () => {
    const completions: Array<(outcome: DocumentWriteOutcome) => void> = [];
    const reviewCompletions: Array<(outcome: ReviewReturnWriteOutcome) => void> = [];
    const write = vi.fn(() => new Promise<DocumentWriteOutcome>(resolve => completions.push(resolve)));
    const review = vi.fn<typeof import('@/lib/documentsDb').idbApplyReviewReturn>(() => new Promise<ReviewReturnWriteOutcome>(resolve => reviewCompletions.push(resolve)));
    const queue = new DocumentWrites(write, () => {}, undefined, review), base = document(), first = document('First body');
    queue.enqueue(base, first);
    const importA = withComments(first), a = operation();queue.enqueueReviewReturn(first, importA, a);
    const between = structuredClone(importA);between.session.formData.subject = 'Body between reviews';queue.enqueue(importA, between);
    const importB = withComments(between), b = operation();queue.enqueueReviewReturn(between, importB, b);
    let latest = importB;
    for (let index = 0; index < 10; index++) { latest = structuredClone(importB);latest.session.formData.subject = `Final body ${index}`;queue.enqueue(importB, latest); }
    expect(journal()[0].versions).toHaveLength(5);expect(journal()[0].reviewReturns?.map(marker => marker.index)).toEqual([1, 3]);
    completions[0]('committed');await vi.waitFor(() => expect(review).toHaveBeenCalledTimes(1));
    expect(journal()[0].reviewReturns?.map(marker => marker.index)).toEqual([0, 2]);
    reviewCompletions[0]('committed');await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(journal()[0].reviewReturns?.map(marker => marker.index)).toEqual([1]);
    completions[1]('committed');await vi.waitFor(() => expect(review).toHaveBeenCalledTimes(2));
    expect(journal()[0].reviewReturns?.map(marker => marker.index)).toEqual([0]);
    reviewCompletions[1]('committed');await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));
    completions[2]('committed');expect(await queue.flush()).toBe(true);
    expect(review.mock.calls.map(call => call[3].returnId)).toEqual([a.receipt.returnId, b.receipt.returnId]);
    expect(write).toHaveBeenLastCalledWith(importB, latest);
  });
  it('does not let a later autosave bypass a failed review transaction', async () => {
    let finish!: (outcome: ReviewReturnWriteOutcome) => void;
    const review = vi.fn().mockResolvedValueOnce('failed').mockImplementation(() => new Promise<ReviewReturnWriteOutcome>(resolve => { finish = resolve; }));
    const write = vi.fn().mockResolvedValue('committed');
    const queue = new DocumentWrites(write, () => {}, undefined, review), before = document(), imported = withComments(before);
    queue.enqueueReviewReturn(before, imported, operation());
    await vi.waitFor(() => expect(queue.failure('owner')).toBe('failed'));
    const latest = structuredClone(imported);latest.session.formData.subject = 'Edited after failure';queue.enqueue(imported, latest);
    await vi.waitFor(() => expect(review).toHaveBeenCalledTimes(2));
    expect(write).not.toHaveBeenCalled();expect(journal()[0].reviewReturns).toHaveLength(1);
    expect(queue.latestReceipt('owner')).toBeUndefined();
    finish('committed');expect(await queue.flush()).toBe(true);expect(write).toHaveBeenCalledWith(imported, latest);
  });
  it('queues an edit arriving immediately after commit before publishing the earlier receipt', async () => {
    const write = vi.fn().mockResolvedValue('committed'), review = vi.fn().mockResolvedValue('committed');
    const before = document(), imported = withComments(before), latest = structuredClone(imported);
    latest.session.formData.subject = 'Input at publication';latest.session.reviewComments!.threads[0].messages.push({ id: crypto.randomUUID(), author: 'Drafter', text: 'Local reply', createdAt: '2026-11-13T01:00:00Z' });
    let queued = false;
    const queue = new DocumentWrites(write, (_id, saved) => {
      if (saved && !queued) { queued = true;queue.enqueue(saved, latest);expect(queue.has('owner')).toBe(true); }
    }, undefined, review);
    queue.enqueueReviewReturn(before, imported, operation());
    expect(await queue.flush()).toBe(true);expect(write).toHaveBeenCalledWith(imported, latest);
    expect(queue.matches(queue.latestReceipt('owner'), latest)).toBe(true);
    expect(queue.matches(queue.latestReceipt('owner'), imported)).toBe(false);
  });
  it('never creates a saved receipt for an already imported file against a different revision', async () => {
    const queue = new DocumentWrites(vi.fn().mockResolvedValue('committed'), () => {}, undefined, vi.fn().mockResolvedValue('already-imported'));
    queue.enqueueReviewReturn(document(), withComments(document()), operation());
    expect(await queue.flush()).toBe(false);expect(queue.failure('owner')).toBe('conflict');expect(queue.latestReceipt('owner')).toBeUndefined();
  });
  it('rejects malformed review journal markers before recovery can write anything', async () => {
    let finish!: (outcome: ReviewReturnWriteOutcome) => void;
    const review = vi.fn(() => new Promise<ReviewReturnWriteOutcome>(resolve => { finish = resolve; }));
    const queue = new DocumentWrites(vi.fn(), () => {}, undefined, review), before = document();
    queue.enqueueReviewReturn(before, withComments(before), operation());
    const raw = JSON.parse(sessionStorage.getItem(WRITE_JOURNAL_KEY)!);
    for (const mutate of [
      (value: typeof raw) => { value[0].pending.reviewReturns[0].index = 3; },
      (value: typeof raw) => { value[0].pending.reviewReturns.push(value[0].pending.reviewReturns[0]); },
      (value: typeof raw) => { value[0].pending.reviewReturns[0].operation.receipt.documentId = 'different'; },
      (value: typeof raw) => { value[0].version = 2; },
    ]) { const bad = structuredClone(raw);mutate(bad);expect(() => parseDocumentWriteJournal(bad)).toThrow(); }
    expect(() => parseDocumentWriteJournal([raw[0].pending])).toThrow();
    queue.cancel('owner');finish('committed');await Promise.resolve();
  });
});
