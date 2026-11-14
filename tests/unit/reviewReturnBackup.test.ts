import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { startReviewRound } from '@/lib/reviewRoundActions';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, applyOwnedReviewReturn, captureDocumentTarget, commitCurrentDocument, flushDocumentWrites } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { useProfileStore } from '@/stores/profileStore';
import { idbGetAllDocuments, idbReadReviewReturn, idbDeleteReviewRound, idbDeleteDocument } from '@/lib/documentsDb';
import type { ReviewReturnWrite } from '@/lib/reviewReturns';

beforeEach(() => {
  sessionStorage.clear();useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useUIStore.setState({ storageHealth: 'ok' });
  useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('subject', 'Fictional review source');
});
afterEach(async () => { await flushDocumentWrites();vi.restoreAllMocks(); });
async function fixture() {
  const round = await startReviewRound('Captured review');
  const comments = { version: 1 as const, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' as const }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Example reviewer', text: 'Returned review note', createdAt: '2026-11-13T00:00:00Z' }] }] };
  const operation: ReviewReturnWrite = { kind: 'comment-return', round: { id: round.id, baselineDigest: round.baselineDigest, ownerDocumentId: round.ownerDocumentId! },
    receipt: { kind: 'dondocs-review-return-receipt', version: 1, roundId: round.id, baselineDigest: round.baselineDigest,
      returnId: `return_${crypto.randomUUID()}`, returnDigest: 'b'.repeat(64), documentId: round.ownerDocumentId!, importedAt: Date.now() } };
  expect(await applyOwnedReviewReturn(captureDocumentTarget(), comments, operation)).toBe('committed');
  return { round, comments, operation };
}
it('preserves imported feedback and its receipt in a version 8 workspace round trip', async () => {
  const { round, comments, operation } = await fixture();
  useDocumentStore.getState().setField('subject', 'Newer author work');await commitCurrentDocument();
  const backup = await buildBackup(), parsed = JSON.parse(backup);
  expect(parsed.version).toBe(8);expect(parsed.reviewReturns).toEqual([operation.receipt]);
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);await idbDeleteDocument(round.ownerDocumentId!);
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null });
  const result = await restoreBackup(backup);
  expect(result.issues).toBeUndefined();expect(await idbReadReviewReturn(round.id, operation.receipt.returnId)).toEqual(operation.receipt);
  const restored = (await idbGetAllDocuments())!.find(document => document.id === round.ownerDocumentId)!;
  expect(restored.session.formData.subject).toBe('Newer author work');expect(restored.session.reviewComments).toEqual(comments);
});
it('does not mark old feedback imported beside a newer local discussion revision', async () => {
  const { round, operation } = await fixture();const backup = await buildBackup();
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  useDocumentStore.setState({ reviewComments: undefined });useDocumentStore.getState().setField('subject', 'More recent local revision');await commitCurrentDocument();
  const result = await restoreBackup(backup);
  expect(result.issues?.join(' ')).toContain('receipts were not restored');expect(await idbReadReviewReturn(round.id, operation.receipt.returnId)).toBeNull();
  const restored = (await idbGetAllDocuments())!.find(document => document.id === round.ownerDocumentId)!;
  expect(restored.session.formData.subject).toBe('More recent local revision');expect(restored.session.reviewComments).toBeUndefined();
});
it('rejects a malformed receipt section before changing any workspace data', async () => {
  const { operation } = await fixture();const parsed = JSON.parse(await buildBackup());
  parsed.reviewReturns[0].baselineDigest = 'f'.repeat(64);parsed.documents[0].session.formData.subject = 'Must not restore';
  await expect(restoreBackup(JSON.stringify(parsed))).rejects.toThrow(/receipt/);
  expect(await idbReadReviewReturn(operation.round.id, operation.receipt.returnId)).toEqual(operation.receipt);
  expect(useDocumentStore.getState().formData.subject).toBe('Fictional review source');
});
