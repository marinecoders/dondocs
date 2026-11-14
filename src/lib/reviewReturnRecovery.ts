import {
  idbApplyReviewReturn, idbGetAllDocuments, idbReadReviewReturn, idbReadReviewRound,
  idbWriteDocument, idbApplyReviewSuggestions, idbReadReviewCopy, idbReadReviewSuggestionReceipt, idbReadReviewSuggestions,
  sameReviewStoredValue, isCommentOnlyReviewReturnChange, type DocumentWriteOutcome, type StoredDocument,
} from './documentsDb';
import { parseDocumentWriteJournal, serializeDocumentWriteJournal, type PendingDocumentWrite, type ReviewWrite } from './documentWrites';
import { parseReviewRound, reviewCopyLinkSchema } from './reviewRounds';
import { reviewReturnReceiptSchema } from './reviewReturns';
import { parseSavedSession } from './savedSession';
import { supportsReviewComments } from './reviewCommentTargets';
import { materializeSignatureFallbacks } from './signatureCompatibility';
import { z } from 'zod';
import { planReviewSuggestionWrite, reviewSuggestionReceiptSchema, reviewSuggestionRecordSchema, reviewSuggestionWriteReceipt } from './reviewSuggestionWrites';
import { validateReviewSuggestionState } from './reviewSuggestions';

export const REVIEW_WRITE_RECOVERY_KEY = 'dondocs-review-write-recovery';
const recoveryMetadataSchema = z.object({
  id: z.string().min(1), title: z.string(), docType: z.string().min(1),
  updatedAt: z.number().nonnegative(), name: z.string().optional(),
  pinned: z.boolean().optional(), nativeReviewText: z.literal(true).optional(),
  deletedAt: z.number().nonnegative().optional(),
});

/** Replay known intent without rolling a newer saved version back to an earlier fence. */
export async function recoverReviewReturnWrite(input: PendingDocumentWrite): Promise<DocumentWriteOutcome> {
  const item = parseDocumentWriteJournal(JSON.parse(serializeDocumentWriteJournal([input])))[0];
  const markers = item.reviewReturns!;
  for (const record of [item.before!, ...item.versions]) {
    if (!recoveryMetadataSchema.safeParse(record.meta).success) throw new Error('Invalid review recovery document metadata.');
    parseSavedSession(record.session);
  }
  // Validate every marker and local authority before the first recovery write.
  const checked = await Promise.all(markers.map(async marker => {
    const { operation, index } = marker;
    const prior = index === 0 ? item.before! : item.versions[index - 1];
    if (!supportsReviewComments(prior.session) || !supportsReviewComments(item.versions[index].session)) throw new Error('Unsupported review recovery document.');
    const rawRound = await idbReadReviewRound(operation.round.id);
    if (!rawRound) throw new Error('The review baseline is missing.');
    const round = parseReviewRound(rawRound);
    if (operation.kind === 'suggestion-write') {
      const copy = reviewCopyLinkSchema.safeParse(await idbReadReviewCopy(operation.documentId));
      if (round.baselineDigest !== operation.round.baselineDigest || round.ownerDocumentId !== operation.documentId
        && (operation.intent.kind !== 'propose' || !copy.success || copy.data.documentId !== operation.documentId
          || copy.data.roundId !== round.id || copy.data.baselineDigest !== round.baselineDigest)) throw new Error('The suggestion recovery owner or baseline changed.');
      const planned = planReviewSuggestionWrite(round, prior.session, operation, item.versions[index].session);
      if (!sameReviewStoredValue(planned.session, item.versions[index].session)
        || !sameReviewStoredValue(planned.state, operation.after)) throw new Error('Invalid suggestion recovery intent.');
      const expected = await reviewSuggestionWriteReceipt(operation);
      const saved = await idbReadReviewSuggestionReceipt(operation.id);
      const receipt = saved === null ? null : reviewSuggestionReceiptSchema.parse(saved);
      if (receipt && !sameReviewStoredValue(receipt, expected)) throw new Error('A different suggestion write already uses this receipt identity.');
      if (operation.intent.kind === 'import') {
        const returned = await idbReadReviewReturn(round.id, operation.intent.receipt.returnId);
        if (returned !== null && !sameReviewStoredValue(returned, operation.intent.receipt)
          || receipt !== null && returned === null || returned !== null && receipt === null) throw new Error('The proposal return receipt does not match its atomic suggestion write.');
      }
      if (receipt) {
        const raw = await idbReadReviewSuggestions(operation.documentId, round.id);
        const record = reviewSuggestionRecordSchema.parse(raw);
        const state = validateReviewSuggestionState(round, record.state);
        if (record.documentId !== operation.documentId
          || operation.after.proposals.some(proposal => !state.proposals.some(current => sameReviewStoredValue(current, proposal)))
          || operation.after.decisions.some(decision => !state.decisions.some(current => sameReviewStoredValue(current, decision)))) throw new Error('The saved suggestion history no longer contains this committed write.');
      }
      return { ...marker, received: receipt !== null };
    }
    if (!isCommentOnlyReviewReturnChange(prior, item.versions[index])) throw new Error('A comment return contains unrelated document changes.');
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
    // A genuine atomic suggestion write cannot have saved its document without
    // its metadata receipt. Never invent an acceptance over a later saved edit.
    if (marker.operation.kind === 'suggestion-write') return 'conflict';
    const outcome = await idbApplyReviewReturn(current, current, marker.operation.round, marker.operation.receipt);
    if (outcome !== 'committed' && outcome !== 'already-committed') return outcome === 'already-imported' || outcome === 'stale' ? 'conflict' : outcome;
    wrote ||= outcome === 'committed';
  }
  for (let index = known + 1; index < item.versions.length; index++) {
    const raw = item.versions[index];
    const next: StoredDocument = { ...raw, session: await materializeSignatureFallbacks(raw.session) };
    const marker = checked.find(marker => marker.index === index);
    const apply = (operation: ReviewWrite) => operation.kind === 'suggestion-write'
      ? idbApplyReviewSuggestions(current!, next, operation)
      : idbApplyReviewReturn(current!, next, operation.round, operation.receipt);
    const outcome = marker
      ? await apply(marker.operation)
      : await idbWriteDocument(current, next, [], true);
    if (outcome !== 'committed' && outcome !== 'already-committed') return outcome === 'already-imported' || outcome === 'stale' ? 'conflict' : outcome;
    wrote ||= outcome === 'committed';current = next;
  }
  return wrote ? 'committed' : 'already-committed';
}
