import { transformRangeComments } from './reviewCommentRanges';
import { replaceReviewParagraphText } from './reviewParagraphText';
import { applyReviewStructure } from './reviewStructureSuggestions';
import { z } from 'zod';
import type { DocumentMeta } from '@/stores/documentsStore';
import type { SerializedSession } from '@/stores/documentStore';
import { canonicalReviewPayload, reviewDigestSchema, reviewPayloadDigest, reviewRoundIdSchema, type ReviewRound } from './reviewRounds';
import {
  reviewStructureReservedIds, acceptedReviewSuggestionRange, resolvedReviewSuggestionRange, applyReviewSuggestionRange, appendReviewSuggestions, emptyReviewSuggestionState, planReviewSuggestionDecision, planReviewSuggestionHistory,
  reviewProposalIdSchema, reviewSuggestionResolutionSchema, reviewSuggestionSchema, reviewSuggestionStateSchema, validateReviewSuggestionState,
} from './reviewSuggestions';
import { reviewCommentsSchema } from './reviewComments';
import { reviewReturnReceiptSchema } from './reviewReturns';

const identifier = z.string().min(1).max(200);
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
const record = z.object({ id: z.string().uuid(), decidedAt: timestamp }).strict();
export const reviewSuggestionWriteIdSchema = z.string().regex(/^suggestion-write_[0-9a-f-]{36}$/)
  .refine(value => z.string().uuid().safeParse(value.slice(17)).success);
export const reviewSuggestionIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('propose'), proposals: z.array(reviewSuggestionSchema).min(1).max(100) }).strict(),
  z.object({ kind: z.literal('decide'), proposalId: reviewProposalIdSchema, action: z.enum(['accepted', 'rejected']), record,
    resolutions: z.array(reviewSuggestionResolutionSchema).min(1).max(1).optional() }).strict(),
  z.object({ kind: z.literal('history'), acceptanceId: z.string().uuid(), direction: z.enum(['undo', 'redo']), record }).strict(),
  z.object({ kind: z.literal('import'), proposals: z.array(reviewSuggestionSchema).min(1).max(100), comments: reviewCommentsSchema.optional(),
    receipt: reviewReturnReceiptSchema }).strict(),
]);
export type ReviewSuggestionIntent = z.infer<typeof reviewSuggestionIntentSchema>;

/** Metadata lives beside its source document, never in the clean letter model. */
export const reviewSuggestionRecordSchema = z.object({ documentId: identifier, state: reviewSuggestionStateSchema }).strict();
export type ReviewSuggestionRecord = z.infer<typeof reviewSuggestionRecordSchema>;
export const reviewSuggestionWriteSchema = z.object({
  kind: z.literal('suggestion-write'), version: z.literal(1), id: reviewSuggestionWriteIdSchema,
  documentId: identifier, createdAt: timestamp,
  round: z.object({ id: reviewRoundIdSchema, baselineDigest: reviewDigestSchema }).strict(),
  before: reviewSuggestionStateSchema.nullable(), after: reviewSuggestionStateSchema,
  intent: reviewSuggestionIntentSchema,
}).strict();
export type ReviewSuggestionWrite = z.infer<typeof reviewSuggestionWriteSchema>;
export const reviewSuggestionReceiptSchema = z.object({
  kind: z.literal('dondocs-suggestion-write-receipt'), version: z.literal(1),
  writeId: reviewSuggestionWriteIdSchema, writeDigest: reviewDigestSchema,
  documentId: identifier, roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema, committedAt: timestamp,
}).strict();
export type ReviewSuggestionReceipt = z.infer<typeof reviewSuggestionReceiptSchema>;

export async function reviewSuggestionWriteReceipt(input: ReviewSuggestionWrite): Promise<ReviewSuggestionReceipt> {
  const operation = reviewSuggestionWriteSchema.parse(input);
  return { kind: 'dondocs-suggestion-write-receipt', version: 1, writeId: operation.id,
    writeDigest: await reviewPayloadDigest(operation), documentId: operation.documentId,
    roundId: operation.round.id, baselineDigest: operation.round.baselineDigest, committedAt: operation.createdAt };
}

/** Accepted native text uses the existing reader hint; no other review action can promote it. */
export function reviewSuggestionWriteMetadata(before: DocumentMeta, operation: ReviewSuggestionWrite): DocumentMeta {
  return { ...before, ...(operation.intent.kind === 'decide' && operation.intent.action === 'accepted' ? { nativeReviewText: true as const } : {}) };
}
export function isReviewSuggestionMetadataChange(before: DocumentMeta, after: DocumentMeta, operation: ReviewSuggestionWrite): boolean {
  const { updatedAt: _beforeTime, ...expected } = reviewSuggestionWriteMetadata(before, operation);
  const { updatedAt: _afterTime, ...actual } = after;
  return canonicalReviewPayload(expected) === canonicalReviewPayload(actual);
}

/** Derive only the allowed replacement, rather than trusting an arbitrary queued document. */
export function planReviewSuggestionWrite(round: ReviewRound, source: SerializedSession, input: ReviewSuggestionWrite,
  historyDestination?: SerializedSession): { session: SerializedSession; state: ReviewSuggestionWrite['after'] } {
  const operation = reviewSuggestionWriteSchema.parse(input);
  if (operation.round.id !== round.id || operation.round.baselineDigest !== round.baselineDigest) throw new Error('The suggestion write belongs to another review baseline.');
  const state = operation.before === null ? emptyReviewSuggestionState(round) : validateReviewSuggestionState(round, operation.before);
  const intent = operation.intent;
  if (intent.kind === 'propose') return { session: structuredClone(source), state: appendReviewSuggestions(round, state, intent.proposals) };
  if (intent.kind === 'import') {
    if (intent.receipt.documentId !== operation.documentId || intent.receipt.roundId !== round.id
      || intent.receipt.baselineDigest !== round.baselineDigest) throw new Error('The suggestion return receipt targets another owner or baseline.');
    const session = structuredClone(source);
    if (intent.comments?.threads.length) session.reviewComments = intent.comments;
    else delete session.reviewComments;
    return { session, state: appendReviewSuggestions(round, state, intent.proposals) };
  }
  if (intent.kind === 'decide') {
    const plan = planReviewSuggestionDecision(round, source, state, intent.proposalId, intent.action, intent.record, intent.resolutions);
    if (plan.status !== 'ready') throw new Error('The suggestion has changed or already has a decision.');
    return { session: plan.session, state: plan.state };
  }
  if (!historyDestination) throw new Error('The review history destination is unavailable.');
  // The ordinary history entry supplies the destination; the owner must tag its
  // acceptance and the database verifies that no unrelated fields are rewritten.
  let next = structuredClone(source);
  const acceptance = state.decisions.find(decision => decision.id === intent.acceptanceId && decision.action === 'accepted');
  const proposal = acceptance && state.proposals.find(item => item.id === acceptance.proposalId);
  if (!proposal) throw new Error('The accepted suggestion is unavailable.');
  for (const change of proposal.changes) {
    const target = change.target;
    const resolution = acceptance!.resolutions?.find(item => item.changeId === change.id);
    const value = intent.direction === 'undo' ? resolution?.expectedCurrent ?? change.expected : resolution?.value ?? change.proposed;
    if (target.kind === 'field') Object.assign(next.formData, { [target.field]: value });
    else if (target.kind === 'paragraph') replaceReviewParagraphText(next, target.paragraphId, value);
    else if (target.kind === 'range') {
      const original = resolution?.expectedCurrent ?? change.expected, applied = resolution?.value ?? change.proposed;
      const scope = resolvedReviewSuggestionRange(target, resolution);
      const range = intent.direction === 'undo' ? acceptedReviewSuggestionRange(scope, applied) : scope;
      next = applyReviewSuggestionRange(next, range, intent.direction === 'undo' ? applied : original, value);
    } else if (target.kind === 'structure') {
      next = applyReviewStructure(next, target, intent.direction === 'undo' ? 'reverse' : 'forward', reviewStructureReservedIds(state, proposal.id));
    } else {
      const reference = next.references[target.referenceIndex];
      if (!reference) throw new Error('The accepted reference title is unavailable.');
      reference.title = value;
    }
  }
  if (proposal.changes.some(change => change.target.kind === 'paragraph')) {
    const destination = historyDestination.reviewComments && reviewCommentsSchema.parse(historyDestination.reviewComments);
    const replay = structuredClone(intent.direction === 'undo' ? next : source);
    if (intent.direction === 'undo') {
      if (destination) replay.reviewComments = structuredClone(destination);
      else delete replay.reviewComments;
    }
    for (const change of proposal.changes) if (change.target.kind === 'paragraph')
      replaceReviewParagraphText(replay, change.target.paragraphId,
        acceptance!.resolutions?.find(item => item.changeId === change.id)?.value ?? change.proposed);
    const expected = intent.direction === 'undo' ? source.reviewComments : destination;
    if (canonicalReviewPayload(replay.reviewComments ?? null) !== canonicalReviewPayload(expected ?? null))
      throw new Error('This history action changes discussion content beyond the accepted paragraph text.');
    if (destination) next.reviewComments = structuredClone(destination);
    else delete next.reviewComments;
  }
  if (proposal.changes.some(change => change.target.kind === 'structure')) {
    const destination = historyDestination.reviewComments && reviewCommentsSchema.parse(historyDestination.reviewComments);
    let replay = structuredClone(intent.direction === 'undo' ? next : source);
    if (intent.direction === 'undo') {
      if (destination) replay.reviewComments = structuredClone(destination);
      else delete replay.reviewComments;
    }
    for (const change of proposal.changes) if (change.target.kind === 'structure')
      replay = applyReviewStructure(replay, change.target, 'forward', reviewStructureReservedIds(state, proposal.id));
    const expected = intent.direction === 'undo' ? source.reviewComments : destination;
    if (canonicalReviewPayload(replay.reviewComments ?? null) !== canonicalReviewPayload(expected ?? null))
      throw new Error('This history action changes discussion content beyond the accepted paragraph operation.');
    if (destination) next.reviewComments = structuredClone(destination);
    else delete next.reviewComments;
  }
  if (proposal.changes.some(change => change.target.kind === 'range')) {
    // A touched comment detaches on acceptance. Undo can restore its earlier
    // anchor only when replaying that exact splice recreates the entire current
    // discussion state; messages, history and unrelated anchors cannot change.
    const destination = historyDestination.reviewComments && reviewCommentsSchema.parse(historyDestination.reviewComments);
    let comments = intent.direction === 'undo' ? destination : source.reviewComments;
    for (const change of proposal.changes) if (change.target.kind === 'range') {
      const paragraphId = change.target.paragraphId;
      const beforeParagraph = (intent.direction === 'undo' ? next : source).paragraphs.find(item => item.id === paragraphId)!;
      const afterParagraph = (intent.direction === 'undo' ? source : next).paragraphs.find(item => item.id === paragraphId)!;
      comments = transformRangeComments(comments, beforeParagraph, afterParagraph);
    }
    const expected = intent.direction === 'undo' ? source.reviewComments : destination;
    if (canonicalReviewPayload(comments ?? null) !== canonicalReviewPayload(expected ?? null))
      throw new Error('This history action changes discussion content beyond the accepted text range.');
    if (destination) next.reviewComments = structuredClone(destination);
    else delete next.reviewComments;
  }
  return { session: next, state: planReviewSuggestionHistory(round, source, historyDestination, state,
    intent.acceptanceId, intent.direction, intent.record) };
}
