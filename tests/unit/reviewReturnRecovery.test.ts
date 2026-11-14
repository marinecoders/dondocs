import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { idbAddReviewRound, idbApplyReviewReturn, idbGetAllDocuments, idbPutDocument, idbReadReviewReturn, type StoredDocument } from '@/lib/documentsDb';
import { recoverReviewReturnWrite } from '@/lib/reviewReturnRecovery';
import { parseDocumentWriteJournal, serializeDocumentWriteJournal, type PendingDocumentWrite } from '@/lib/documentWrites';
import type { ReviewRound } from '@/lib/reviewRounds';
import type { ReviewReturnWrite } from '@/lib/reviewReturns';

let before: StoredDocument, imported: StoredDocument, latest: StoredDocument, operation: ReviewReturnWrite;
beforeEach(async () => {
  const id = crypto.randomUUID(), session = createBlankSession();session.timestamp = 100;session.formData.subject = 'Original';
  before = { id, meta: { id, title: 'Draft', docType: 'naval_letter', updatedAt: 100 }, session };
  imported = structuredClone(before);imported.meta.updatedAt = 200;
  imported.session.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Example reviewer', text: 'Returned feedback', createdAt: '2026-11-13T00:00:00Z' }] }] };
  latest = structuredClone(imported);latest.session.formData.subject = 'Later author text';latest.meta.updatedAt = 300;
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 100,
    label: 'Review', sourceDocumentId: id, ownerDocumentId: id, baselineDigest: 'a'.repeat(64), baseline: { ts: 100, session } };
  operation = { kind: 'comment-return', round: { id: round.id, baselineDigest: round.baselineDigest, ownerDocumentId: id },
    receipt: { kind: 'dondocs-review-return-receipt', version: 1, roundId: round.id, baselineDigest: round.baselineDigest,
      returnId: `return_${crypto.randomUUID()}`, returnDigest: 'b'.repeat(64), documentId: id, importedAt: 200 } };
  expect(await idbPutDocument(before)).toBe(true);expect(await idbAddReviewRound(round)).toBe('committed');
});
const pending = (): PendingDocumentWrite => ({ before, versions: [imported, latest], reviewReturns: [{ index: 0, operation }] });
const saved = async () => (await idbGetAllDocuments())!.find(record => record.id === before.id);
const receipt = () => idbReadReviewReturn(operation.round.id, operation.receipt.returnId);

describe('interrupted review return recovery', () => {
  it('replays a pending return and then newer author work, retaining both', async () => {
    expect(await recoverReviewReturnWrite(pending())).toBe('committed');
    expect(await saved()).toEqual(latest);expect(await receipt()).toEqual(operation.receipt);
  });
  it('acknowledges a transaction committed before a crash without importing twice', async () => {
    expect(await idbApplyReviewReturn(before, imported, operation.round, operation.receipt)).toBe('committed');
    expect(await recoverReviewReturnWrite(pending())).toBe('committed');
    expect(await saved()).toEqual(latest);expect(await receipt()).toEqual(operation.receipt);
    expect(await recoverReviewReturnWrite(pending())).toBe('already-committed');
  });
  it('does not roll back a known later version, including a deliberate Undo', async () => {
    const undo = structuredClone(latest);delete undo.session.reviewComments;undo.meta.updatedAt = 400;
    await idbApplyReviewReturn(before, imported, operation.round, operation.receipt);await idbPutDocument(undo);
    expect(await recoverReviewReturnWrite({ ...pending(), versions: [imported, latest, undo] })).toBe('already-committed');
    expect(await saved()).toEqual(undo);expect(await receipt()).toEqual(operation.receipt);
  });
  it('records missing receipt intent for an already durable latest version without restoring old text', async () => {
    await idbPutDocument(latest);
    expect(await recoverReviewReturnWrite(pending())).toBe('committed');
    expect(await saved()).toEqual(latest);expect(await receipt()).toEqual(operation.receipt);
  });
  it('preserves an unknown newer foreign revision and writes no receipt', async () => {
    const foreign = structuredClone(before);foreign.session.formData.subject = 'Newer work from another tab';foreign.meta.updatedAt = 999;
    await idbPutDocument(foreign);
    expect(await recoverReviewReturnWrite(pending())).toBe('conflict');expect(await saved()).toEqual(foreign);expect(await receipt()).toBeNull();
  });
  it('does not replay a receipted return over another tab’s later Undo', async () => {
    await idbApplyReviewReturn(before, imported, operation.round, operation.receipt);await idbPutDocument(before);
    expect(await recoverReviewReturnWrite(pending())).toBe('conflict');expect(await saved()).toEqual(before);
  });
  it('validates every marker before replaying even an earlier ordinary edit', async () => {
    const first = structuredClone(before);first.session.formData.subject = 'Intermediate';
    const bad = { ...operation, receipt: { ...operation.receipt, documentId: 'unrelated' } };
    await expect(recoverReviewReturnWrite({ before, versions: [first, imported], reviewReturns: [{ index: 1, operation: bad }] })).rejects.toThrow();
    expect(await saved()).toEqual(before);expect(await receipt()).toBeNull();
  });
  it('rejects a later comment fence that carries a body edit before committing an earlier valid fence', async () => {
    const second = structuredClone(operation);second.receipt.returnId = `return_${crypto.randomUUID()}`;
    await expect(recoverReviewReturnWrite({ before, versions: [imported, latest], reviewReturns: [{ index: 0, operation }, { index: 1, operation: second }] })).rejects.toThrow(/unrelated document changes/);
    expect(await saved()).toEqual(before);expect(await receipt()).toBeNull();expect(await idbReadReviewReturn(second.round.id, second.receipt.returnId)).toBeNull();
  });
  it('fails closed before any write when a later baseline is unavailable', async () => {
    const otherId = `review_${crypto.randomUUID()}`;
    const other = { ...operation, round: { ...operation.round, id: otherId }, receipt: { ...operation.receipt, roundId: otherId } };
    const second = structuredClone(imported);second.meta.updatedAt++;
    await expect(recoverReviewReturnWrite({ before, versions: [imported, second], reviewReturns: [{ index: 0, operation }, { index: 1, operation: other }] })).rejects.toThrow(/baseline/);
    expect(await saved()).toEqual(before);expect(await receipt()).toBeNull();
  });
  it.each([
    { title: { text: 'Invalid title' } },
    { name: ['Invalid name'] },
    { updatedAt: 'later' },
    { updatedAt: Infinity },
    { updatedAt: NaN },
    { pinned: 'yes' },
    { nativeReviewText: false },
    { deletedAt: -1 },
  ])('rejects malformed later document metadata before saving feedback: %j', async invalid => {
    Object.assign(latest.meta, invalid);
    await expect(recoverReviewReturnWrite(pending())).rejects.toThrow(/metadata/);
    expect(await saved()).toEqual(before);expect(await receipt()).toBeNull();
  });
  it('rejects malformed before metadata without modifying the saved document or writing a receipt', async () => {
    const invalid = pending();invalid.before = structuredClone(before);
    Object.assign(invalid.before.meta, { title: { text: 'Invalid title' } });
    await expect(recoverReviewReturnWrite(invalid)).rejects.toThrow(/metadata/);
    expect(await saved()).toEqual(before);expect(await receipt()).toBeNull();
  });
  it('retains unknown metadata fields without changing the captured revisions', async () => {
    for (const record of [before, imported, latest]) Object.assign(record.meta, { futureHint: { value: 'retained' } });
    await idbPutDocument(before);
    expect(await recoverReviewReturnWrite(pending())).toBe('committed');
    expect(await saved()).toEqual(latest);expect(await receipt()).toEqual(operation.receipt);
  });
  it('recovers a serialized journal when optional saved properties have undefined values', async () => {
    for (const record of [before, imported, latest]) record.session.formData.signatureImage = undefined;
    await idbPutDocument(before);
    const serialized = parseDocumentWriteJournal(JSON.parse(serializeDocumentWriteJournal([pending()])))[0];
    expect(await recoverReviewReturnWrite(serialized)).toBe('committed');
    expect((await saved())?.session.formData.subject).toBe('Later author text');
    expect(await receipt()).toEqual(operation.receipt);
  });
});
