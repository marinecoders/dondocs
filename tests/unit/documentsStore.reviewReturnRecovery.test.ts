import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlankSession, useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, commitCurrentDocument, flushDocumentWrites, hasPendingReviewWrites, exportLibrary, openRecoveredCopies } from '@/stores/documentsStore';
import { idbAddReviewRound, idbGetAllDocuments, idbPutDocument, idbReadReviewReturn, idbSetCurrentId, type StoredDocument } from '@/lib/documentsDb';
import { serializeDocumentWriteJournal, WRITE_JOURNAL_KEY, type PendingDocumentWrite } from '@/lib/documentWrites';
import { REVIEW_WRITE_RECOVERY_KEY } from '@/lib/reviewReturnRecovery';
import { readReviewCopyLink, type ReviewRound } from '@/lib/reviewRounds';
import type { ReviewReturnWrite } from '@/lib/reviewReturns';

let before: StoredDocument, latest: StoredDocument, operation: ReviewReturnWrite, pending: PendingDocumentWrite;
beforeEach(async () => {
  sessionStorage.clear();
  const id = crypto.randomUUID(), session = createBlankSession();session.timestamp = 100;session.formData.subject = 'Before review';
  before = { id, meta: { id, title: 'Draft', docType: 'naval_letter', updatedAt: 100 }, session };
  const imported = structuredClone(before);imported.meta.updatedAt = 200;
  imported.session.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Example reviewer', text: 'Returned feedback', createdAt: '2026-11-13T00:00:00Z' }] }] };
  latest = structuredClone(imported);latest.session.formData.subject = 'Later author work';latest.meta.updatedAt = 300;
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 100,
    label: 'Review', sourceDocumentId: id, ownerDocumentId: id, baselineDigest: 'a'.repeat(64), baseline: { ts: 100, session } };
  operation = { kind: 'comment-return', round: { id: round.id, baselineDigest: round.baselineDigest, ownerDocumentId: id },
    receipt: { kind: 'dondocs-review-return-receipt', version: 1, roundId: round.id, baselineDigest: round.baselineDigest,
      returnId: `return_${crypto.randomUUID()}`, returnDigest: 'b'.repeat(64), documentId: id, importedAt: 200 } };
  pending = { before, versions: [imported, latest], reviewReturns: [{ index: 0, operation }] };
  await idbPutDocument(before);await idbAddReviewRound(round);await idbSetCurrentId(id);
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: false });
});
afterEach(async () => {
  sessionStorage.removeItem(REVIEW_WRITE_RECOVERY_KEY);sessionStorage.removeItem(WRITE_JOURNAL_KEY);
  useDocumentsStore.setState({ hydrated: false });await useDocumentsStore.getState().init();
  await flushDocumentWrites();
});
const record = async (id = before.id) => (await idbGetAllDocuments())!.find(item => item.id === id)!;

describe('workspace recovery of review-return writes', () => {
  it('recovers feedback, receipt and later body edits before reopening the source', async () => {
    sessionStorage.setItem(WRITE_JOURNAL_KEY, serializeDocumentWriteJournal([pending]));
    await useDocumentsStore.getState().init();
    expect(useDocumentsStore.getState().currentId).toBe(before.id);
    expect(useDocumentStore.getState().formData.subject).toBe('Later author work');expect(useDocumentStore.getState().reviewComments).toEqual(latest.session.reviewComments);
    expect(await idbReadReviewReturn(operation.round.id, operation.receipt.returnId)).toEqual(operation.receipt);
    expect(sessionStorage.getItem(REVIEW_WRITE_RECOVERY_KEY)).toBeNull();
  });
  it('retains typed intent and a recoverable copy when newer foreign work prevents replay', async () => {
    const foreign = structuredClone(before);foreign.session.formData.subject = 'Another tab saved newer text';foreign.meta.updatedAt = 999;
    await idbPutDocument(foreign);sessionStorage.setItem(WRITE_JOURNAL_KEY, serializeDocumentWriteJournal([pending]));
    await useDocumentsStore.getState().init();
    expect((await record()).session.formData.subject).toBe('Another tab saved newer text');
    expect(useDocumentsStore.getState().recoveryCount).toBe(1);expect(hasPendingReviewWrites()).toBe(true);
    expect(sessionStorage.getItem(REVIEW_WRITE_RECOVERY_KEY)).toContain(operation.receipt.returnId);
    await expect(exportLibrary()).rejects.toThrow(/interrupted review return/);
    expect(await idbReadReviewReturn(operation.round.id, operation.receipt.returnId)).toBeNull();
    await openRecoveredCopies();
    const newId = useDocumentsStore.getState().currentId!;
    expect(newId).not.toBe(before.id);expect(useDocumentStore.getState().formData.subject).toBe('Later author work');
    expect(useDocumentStore.getState().reviewComments).toEqual(latest.session.reviewComments);
    expect((await record()).session.formData.subject).toBe('Another tab saved newer text');
    expect(await readReviewCopyLink(newId)).toBeNull();expect(await idbReadReviewReturn(operation.round.id, operation.receipt.returnId)).toBeNull();
    expect(hasPendingReviewWrites()).toBe(false);
  });
  it.each(['foreign', 'future'] as const)('retains %s review intent through unrelated normal writes and a fresh hydration', async kind => {
    if (kind === 'foreign') {
      const foreign = structuredClone(before);foreign.meta.updatedAt = 999;foreign.session.formData.subject = 'Another tab';await idbPutDocument(foreign);
    }
    const entries = JSON.parse(serializeDocumentWriteJournal([pending]));
    if (kind === 'future') entries[0].version = 99;
    sessionStorage.setItem(WRITE_JOURNAL_KEY, JSON.stringify(entries));
    await useDocumentsStore.getState().init();
    const retained = sessionStorage.getItem(REVIEW_WRITE_RECOVERY_KEY);
    expect(retained).toContain(operation.receipt.returnId);
    useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('subject', 'Unrelated draft');
    await commitCurrentDocument();
    expect(sessionStorage.getItem(REVIEW_WRITE_RECOVERY_KEY)).toBe(retained);
    // A fresh module has no retained in-memory flag and must discover the durable quarantine.
    vi.resetModules();
    const fresh = await import('@/stores/documentsStore');
    await fresh.useDocumentsStore.getState().init();
    expect(sessionStorage.getItem(REVIEW_WRITE_RECOVERY_KEY)).toContain(operation.receipt.returnId);
    expect(fresh.hasPendingReviewWrites()).toBe(true);
    expect(await idbReadReviewReturn(operation.round.id, operation.receipt.returnId)).toBeNull();
  });
  it('keeps an unsupported review journal out of ordinary backups instead of dropping its semantics', async () => {
    const raw = JSON.parse(serializeDocumentWriteJournal([pending]));raw[0].version = 99;
    sessionStorage.setItem(WRITE_JOURNAL_KEY, JSON.stringify(raw));
    await useDocumentsStore.getState().init();
    expect((await record()).session.reviewComments).toBeUndefined();expect(hasPendingReviewWrites()).toBe(true);
    expect(sessionStorage.getItem(REVIEW_WRITE_RECOVERY_KEY)).toContain('99');
    await expect(exportLibrary()).rejects.toThrow(/interrupted review return/);
  });
});
