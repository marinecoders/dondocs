import {
  idbApplyReviewReturn, idbGetAllDocuments, idbReadReviewReturn, idbReadReviewRound,
  idbWriteDocument, sameReviewStoredValue, isCommentOnlyReviewReturnChange, type DocumentWriteOutcome, type StoredDocument,
} from './documentsDb';
import { parseDocumentWriteJournal, type PendingDocumentWrite } from './documentWrites';
import { parseReviewRound } from './reviewRounds';
import { reviewReturnReceiptSchema } from './reviewReturns';
import { parseSavedSession } from './savedSession';
import { supportsReviewComments } from './reviewCommentTargets';
import { materializeSignatureFallbacks } from './signatureCompatibility';

export const REVIEW_WRITE_RECOVERY_KEY = 'dondocs-review-write-recovery';

/** Replay known intent without rolling a newer saved version back to an earlier fence. */
export async function recoverReviewReturnWrite(input: PendingDocumentWrite): Promise<DocumentWriteOutcome> {
  const item = parseDocumentWriteJournal([{ kind: 'dondocs-review-write', version: 1, pending: input }])[0];
  const markers = item.reviewReturns!;
  for (const record of [item.before!, ...item.versions]) parseSavedSession(record.session);
  // Validate every marker and local authority before the first recovery write.
  const checked = await Promise.all(markers.map(async marker => {
    const { operation, index } = marker;
    const prior = index === 0 ? item.before! : item.versions[index - 1];
    if (!supportsReviewComments(prior.session) || !supportsReviewComments(item.versions[index].session)) throw new Error('Unsupported review recovery document.');
    if (!isCommentOnlyReviewReturnChange(prior, item.versions[index])) throw new Error('A comment return contains unrelated document changes.');
    const rawRound = await idbReadReviewRound(operation.round.id);
    if (!rawRound) throw new Error('The review baseline is missing.');
    const round = parseReviewRound(rawRound);
    if (round.ownerDocumentId !== operation.receipt.documentId || round.baselineDigest !== operation.round.baselineDigest) throw new Error('The review recovery owner or baseline changed.');
    const rawReceipt = await idbReadReviewReturn(round.id, operation.receipt.returnId);
    const receipt = rawReceipt === null ? null : reviewReturnReceiptSchema.parse(rawReceipt);
    if (receipt && (receipt.returnDigest !== operation.receipt.returnDigest || receipt.documentId !== operation.receipt.documentId
      || receipt.baselineDigest !== round.baselineDigest || receipt.roundId !== round.id || receipt.returnId !== operation.receipt.returnId)) throw new Error('A different return already uses this receipt identity.');
    return { ...marker, received: receipt !== null };
  }));
  const records = await idbGetAllDocuments();
  if (records === null) throw new Error('The saved review document could not be read.');
  let current = records.find(record => record.id === item.before!.id);
  if (!current) return 'missing-document';
  let known = -1;
  item.versions.forEach((record, index) => { if (sameReviewStoredValue(current, record)) known = index; });
  if (known < 0 && !sameReviewStoredValue(current, item.before)) return 'conflict';
  // A receipt for a later fence with an earlier saved draft can represent an Undo
  // in another tab. It must not be replayed over that deliberate newer state.
  if (checked.some(marker => marker.index > known && marker.received)) return 'conflict';
  let wrote = false;
  for (const marker of checked.filter(marker => marker.index <= known && !marker.received)) {
    const outcome = await idbApplyReviewReturn(current, current, marker.operation.round, marker.operation.receipt);
    if (outcome !== 'committed' && outcome !== 'already-committed') return outcome === 'already-imported' || outcome === 'stale' ? 'conflict' : outcome;
    wrote ||= outcome === 'committed';
  }
  for (let index = known + 1; index < item.versions.length; index++) {
    const raw = item.versions[index];
    const next: StoredDocument = { ...raw, session: await materializeSignatureFallbacks(raw.session) };
    const marker = checked.find(marker => marker.index === index);
    const outcome = marker
      ? await idbApplyReviewReturn(current, next, marker.operation.round, marker.operation.receipt)
      : await idbWriteDocument(current, next, [], true);
    if (outcome !== 'committed' && outcome !== 'already-committed') return outcome === 'already-imported' || outcome === 'stale' ? 'conflict' : outcome;
    wrote ||= outcome === 'committed';current = next;
  }
  return wrote ? 'committed' : 'already-committed';
}
