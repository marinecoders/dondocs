import { z } from 'zod';
import { reviewCommentsSchema, type ReviewComments } from './reviewComments';
import { canonicalReviewPayload, reviewDigestSchema, reviewPayloadDigest, reviewRoundIdSchema } from './reviewRounds';
import { idbReadReviewReturn, idbReadReviewReturns } from './documentsDb';

export const REVIEW_RETURN_KIND = 'dondocs-review-return';
export const MAX_REVIEW_RETURN_BYTES = 2 * 1024 * 1024;
export const reviewReturnIdSchema = z.string().regex(/^return_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);

/** A return deliberately has no document body, fields, attachment handles or owner ID. */
export const reviewReturnSchema = z.object({
  kind: z.literal(REVIEW_RETURN_KIND), version: z.literal(1),
  id: reviewReturnIdSchema, roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
  createdAt: timestamp, comments: reviewCommentsSchema.optional(),
  handling: z.object({ marking: z.string().min(1).max(200), customMarkings: z.array(z.string().min(1).max(1_000)).max(100) }).strict(),
}).strict();
export type ReviewReturn = z.infer<typeof reviewReturnSchema>;

export const reviewReturnReceiptSchema = z.object({
  kind: z.literal('dondocs-review-return-receipt'), version: z.literal(1),
  roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
  returnId: reviewReturnIdSchema, returnDigest: reviewDigestSchema,
  documentId: z.string().min(1).max(200), importedAt: timestamp,
}).strict();
export type ReviewReturnReceipt = z.infer<typeof reviewReturnReceiptSchema>;

export const reviewReturnWriteSchema = z.object({
  kind: z.literal('comment-return'),
  round: z.object({ id: reviewRoundIdSchema, baselineDigest: reviewDigestSchema, ownerDocumentId: z.string().min(1).max(200) }).strict(),
  receipt: reviewReturnReceiptSchema,
}).strict().superRefine((value, context) => {
  if (value.round.id !== value.receipt.roundId || value.round.baselineDigest !== value.receipt.baselineDigest
    || value.round.ownerDocumentId !== value.receipt.documentId) {
    context.addIssue({ code: 'custom', message: 'The review write does not match its owner and baseline.' });
  }
});
export type ReviewReturnWrite = z.infer<typeof reviewReturnWriteSchema>;

export function parseReviewReturn(value: unknown): ReviewReturn {
  const parsed = reviewReturnSchema.parse(value);
  if (new TextEncoder().encode(canonicalReviewPayload(parsed)).byteLength > MAX_REVIEW_RETURN_BYTES) {
    throw new Error('This review return exceeds the 2 MB transfer limit.');
  }
  return parsed;
}

export function createReviewReturn(roundId: string, baselineDigest: string, comments: ReviewComments | undefined, handling: ReviewReturn['handling']): ReviewReturn {
  return parseReviewReturn({ kind: REVIEW_RETURN_KIND, version: 1, id: `return_${crypto.randomUUID()}`,
    roundId, baselineDigest, createdAt: Date.now(), handling, ...(comments?.threads.length ? { comments } : {}) });
}

export async function reviewReturnDigest(value: ReviewReturn): Promise<string> {
  return reviewPayloadDigest(parseReviewReturn(value));
}

export async function readReviewReturnReceipt(roundId: string, returnId: string): Promise<ReviewReturnReceipt | null> {
  reviewRoundIdSchema.parse(roundId);reviewReturnIdSchema.parse(returnId);
  const raw = await idbReadReviewReturn(roundId, returnId);
  if (raw === null) return null;
  const receipt = reviewReturnReceiptSchema.parse(raw);
  if (receipt.roundId !== roundId || receipt.returnId !== returnId) throw new Error('The saved review receipt has an invalid identity.');
  return receipt;
}

export async function readReviewReturnReceipts(): Promise<ReviewReturnReceipt[]> {
  return (await idbReadReviewReturns()).map(receipt => reviewReturnReceiptSchema.parse(receipt));
}
