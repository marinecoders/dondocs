import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { idbAddReviewRound, idbApplyReviewReturn, idbGetAllDocuments, idbPutDocument, idbReadReviewReturn, idbReadReviewReturnBackup, idbRestoreReviewReturns, sameReviewStoredValue, type StoredDocument } from '@/lib/documentsDb';
import { type ReviewRound } from '@/lib/reviewRounds';
import { type ReviewReturnReceipt } from '@/lib/reviewReturns';

let before: StoredDocument, after: StoredDocument, round: ReviewRound, receipt: ReviewReturnReceipt;
beforeEach(async () => {
  vi.restoreAllMocks();
  const id = crypto.randomUUID(), session = createBlankSession();session.formData.subject = 'Newer owner draft';
  before = { id, meta: { id, title: 'Newer owner draft', docType: 'naval_letter', updatedAt: 100 }, session };
  after = structuredClone(before);after.meta.updatedAt = 200;
  after.session.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Example reviewer', text: 'Returned feedback', createdAt: '2026-11-13T00:00:00Z' }] }] };
  round = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 100, label: 'Review',
    sourceDocumentId: id, ownerDocumentId: id, baselineDigest: 'a'.repeat(64), baseline: { ts: 100, session: createBlankSession() } };
  round.baseline.session.timestamp = 100;
  receipt = { kind: 'dondocs-review-return-receipt', version: 1, roundId: round.id, baselineDigest: round.baselineDigest,
    returnId: `return_${crypto.randomUUID()}`, returnDigest: 'b'.repeat(64), documentId: id, importedAt: 200 };
  expect(await idbPutDocument(before)).toBe(true);expect(await idbAddReviewRound(round)).toBe('committed');
});
const stored = async () => (await idbGetAllDocuments())!.find(record => record.id === before.id);

describe('atomic discussion-return storage', () => {
  it('matches omitted optional JSON properties without collapsing nulls, array slots or bytes', () => {
    expect(sameReviewStoredValue({ nested: { optional: undefined } }, { nested: {} })).toBe(true);
    expect(sameReviewStoredValue({ optional: null }, {})).toBe(false);
    expect(sameReviewStoredValue([undefined], Array(1))).toBe(false);
    expect(sameReviewStoredValue([undefined], [null])).toBe(false);
    expect(sameReviewStoredValue(new Uint8Array([1]).buffer, new Uint8Array([2]).buffer)).toBe(false);
  });
  it('commits only discussion changes and its receipt together', async () => {
    expect(await idbApplyReviewReturn(before, after, round, receipt)).toBe('committed');
    expect(await stored()).toEqual(after);expect(await idbReadReviewReturn(round.id, receipt.returnId)).toEqual(receipt);
  });
  it('does not acknowledge a receipt when the document update transaction aborts', async () => {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const request = put.apply(this, args);
      if (this.name === 'app') this.transaction.abort();
      return request;
    });
    expect(await idbApplyReviewReturn(before, after, round, receipt)).toBe('failed');
    expect(await stored()).toEqual(before);expect(await idbReadReviewReturn(round.id, receipt.returnId)).toBeNull();
  });
  it('preserves another tab’s newer document and writes no receipt', async () => {
    const newer = structuredClone(before);newer.session.formData.subject = 'Saved in another tab';newer.meta.updatedAt = 300;
    await idbPutDocument(newer);
    expect(await idbApplyReviewReturn(before, after, round, receipt)).toBe('conflict');
    expect(await stored()).toEqual(newer);expect(await idbReadReviewReturn(round.id, receipt.returnId)).toBeNull();
  });
  it('cannot change body fields, attachments, metadata or legacy inline bytes', async () => {
    for (const mutate of [
      (record: StoredDocument) => { record.session.formData.subject = 'Overwritten'; },
      (record: StoredDocument) => { record.meta.title = 'Changed title'; },
      (record: StoredDocument) => { record.session.enclosures.push({ title: 'Changed enclosure' } as never); },
      (record: StoredDocument) => { record.session.enclosures.length++; },
    ]) {
      const wrong = structuredClone(after);mutate(wrong);
      expect(await idbApplyReviewReturn(before, wrong, round, receipt)).toBe('conflict');
    }
    before.session.formData.basicLetterFile = { name: 'letter.pdf', size: 1, data: new Uint8Array([1]).buffer };
    await idbPutDocument(before);
    const wrong = structuredClone(before);wrong.session.formData.basicLetterFile!.data = new Uint8Array([2]).buffer;
    expect(await idbApplyReviewReturn(before, wrong, round, receipt)).toBe('conflict');
    expect(await idbReadReviewReturn(round.id, receipt.returnId)).toBeNull();
  });
  it('requires local owner authority, regardless of the portable source identifier', async () => {
    expect(await idbApplyReviewReturn(before, after, { ...round, ownerDocumentId: undefined }, receipt)).toBe('conflict');
    expect(await idbApplyReviewReturn(before, after, { ...round, baselineDigest: 'f'.repeat(64) }, receipt)).toBe('conflict');
    expect(await idbReadReviewReturn(round.id, receipt.returnId)).toBeNull();
  });
  it('makes a repeated return a no-op, including after its feedback has been undone', async () => {
    expect(await idbApplyReviewReturn(before, after, round, receipt)).toBe('committed');
    await idbPutDocument(before);
    expect(await idbApplyReviewReturn(before, after, round, receipt)).toBe('already-imported');
    expect(await stored()).toEqual(before);
  });
  it('rejects different feedback presented under an already imported return identity', async () => {
    expect(await idbApplyReviewReturn(before, after, round, receipt)).toBe('committed');
    expect(await idbApplyReviewReturn(after, after, round, { ...receipt, returnDigest: 'c'.repeat(64) })).toBe('conflict');
    expect(await idbReadReviewReturn(round.id, receipt.returnId)).toEqual(receipt);
  });
  it('captures acknowledgements with the exact saved owner and restores only matching discussions', async () => {
    expect(await idbApplyReviewReturn(before, after, round, receipt)).toBe('committed');
    const snapshot = await idbReadReviewReturnBackup();
    expect(snapshot.receipts).toContainEqual(receipt);expect(snapshot.documents).toContainEqual(after);
    expect(await idbRestoreReviewReturns([receipt], [after])).toBe(true);
    const undone = structuredClone(after);delete undone.session.reviewComments;undone.meta.updatedAt++;
    await idbPutDocument(undone);
    expect(await idbRestoreReviewReturns([receipt], [after])).toBe(false);
    expect(await stored()).toEqual(undone);
  });
  it('does not add acknowledgements beside newer local discussions or different feedback identities', async () => {
    await idbPutDocument(after);
    const newer = structuredClone(after);newer.meta.updatedAt++;
    expect(await idbRestoreReviewReturns([receipt], [newer])).toBe(false);
    expect(await idbReadReviewReturn(round.id, receipt.returnId)).toBeNull();
    expect(await idbRestoreReviewReturns([receipt], [after])).toBe(true);
    expect(await idbRestoreReviewReturns([{ ...receipt, returnDigest: 'c'.repeat(64) }], [after])).toBe(false);
  });
  it('rechecks activation while the IndexedDB reads are pending', async () => {
    let checks = 0;
    expect(await idbApplyReviewReturn(before, after, round, receipt, () => ++checks === 1)).toBe('stale');
    expect(await stored()).toEqual(before);expect(await idbReadReviewReturn(round.id, receipt.returnId)).toBeNull();
  });
});
