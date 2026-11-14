import { z } from 'zod';
import type { SerializedSession } from '@/stores/documentStore';
import { reviewDigestSchema, reviewPayloadDigest, reviewRoundIdSchema, type ReviewRound } from './reviewRounds';
import {
  appendReviewSuggestions, emptyReviewSuggestionState, planReviewSuggestionDecision, planReviewSuggestionHistory,
  reviewProposalIdSchema, reviewSuggestionSchema, reviewSuggestionStateSchema, validateReviewSuggestionState,
} from './reviewSuggestions';

const identifier = z.string().min(1).max(200);
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
const record = z.object({ id: z.string().uuid(), decidedAt: timestamp }).strict();
export const reviewSuggestionWriteIdSchema = z.string().regex(/^suggestion-write_[0-9a-f-]{36}$/)
  .refine(value => z.string().uuid().safeParse(value.slice(17)).success);
export const reviewSuggestionIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('propose'), proposals: z.array(reviewSuggestionSchema).min(1).max(100) }).strict(),
  z.object({ kind: z.literal('decide'), proposalId: reviewProposalIdSchema, action: z.enum(['accepted', 'rejected']), record }).strict(),
  z.object({ kind: z.literal('history'), acceptanceId: z.string().uuid(), direction: z.enum(['undo', 'redo']), record }).strict(),
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

/** Derive only the allowed replacement, rather than trusting an arbitrary queued document. */
export function planReviewSuggestionWrite(round: ReviewRound, source: SerializedSession, input: ReviewSuggestionWrite,
  historyDestination?: SerializedSession): { session: SerializedSession; state: ReviewSuggestionWrite['after'] } {
  const operation = reviewSuggestionWriteSchema.parse(input);
  if (operation.round.id !== round.id || operation.round.baselineDigest !== round.baselineDigest) throw new Error('The suggestion write belongs to another review baseline.');
  const state = operation.before === null ? emptyReviewSuggestionState(round) : validateReviewSuggestionState(round, operation.before);
  const intent = operation.intent;
  if (intent.kind === 'propose') return { session: structuredClone(source), state: appendReviewSuggestions(round, state, intent.proposals) };
  if (intent.kind === 'decide') {
    const plan = planReviewSuggestionDecision(round, source, state, intent.proposalId, intent.action, intent.record);
    if (plan.status !== 'ready') throw new Error('The suggestion has changed or already has a decision.');
    return { session: plan.session, state: plan.state };
  }
  if (!historyDestination) throw new Error('The review history destination is unavailable.');
  // The ordinary history entry supplies the destination; the owner must tag its
  // acceptance and the database verifies that no unrelated fields are rewritten.
  const next = structuredClone(source);
  const acceptance = state.decisions.find(decision => decision.id === intent.acceptanceId && decision.action === 'accepted');
  const proposal = acceptance && state.proposals.find(item => item.id === acceptance.proposalId);
  if (!proposal) throw new Error('The accepted suggestion is unavailable.');
  for (const change of proposal.changes) {
    const target = change.target;
    const value = intent.direction === 'undo' ? change.expected : change.proposed;
    if (target.kind === 'field') Object.assign(next.formData, { [target.field]: value });
    else {
      const paragraph = next.paragraphs.find(item => item.id === target.paragraphId);
      if (!paragraph) throw new Error('The accepted paragraph is unavailable.');
      paragraph.text = value;
    }
  }
  return { session: next, state: planReviewSuggestionHistory(round, source, historyDestination, state,
    intent.acceptanceId, intent.direction, intent.record) };
}
