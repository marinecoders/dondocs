import { z } from 'zod';
import { reviewCommentsSchema, type ReviewComments } from './reviewComments';
import { canonicalReviewPayload, reviewDigestSchema, reviewPayloadDigest, reviewRoundIdSchema } from './reviewRounds';

export const REVIEW_RETURN_KIND = 'dondocs-review-return';
export const MAX_REVIEW_RETURN_BYTES = 2 * 1024 * 1024;
export const reviewReturnIdSchema = z.string().regex(/^return_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);

/** A return deliberately has no document body, fields, attachment handles or owner ID. */
export const reviewReturnSchema = z.object({
  kind: z.literal(REVIEW_RETURN_KIND), version: z.literal(1),
  id: reviewReturnIdSchema, roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
  createdAt: timestamp, comments: reviewCommentsSchema.optional(),
}).strict();
export type ReviewReturn = z.infer<typeof reviewReturnSchema>;

export const reviewReturnReceiptSchema = z.object({
  kind: z.literal('dondocs-review-return-receipt'), version: z.literal(1),
  roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
  returnId: reviewReturnIdSchema, returnDigest: reviewDigestSchema,
  documentId: z.string().min(1).max(200), importedAt: timestamp,
}).strict();
export type ReviewReturnReceipt = z.infer<typeof reviewReturnReceiptSchema>;

export function parseReviewReturn(value: unknown): ReviewReturn {
  const parsed = reviewReturnSchema.parse(value);
  if (new TextEncoder().encode(canonicalReviewPayload(parsed)).byteLength > MAX_REVIEW_RETURN_BYTES) {
    throw new Error('This review return exceeds the 2 MB transfer limit.');
  }
  return parsed;
}

export function createReviewReturn(roundId: string, baselineDigest: string, comments: ReviewComments | undefined): ReviewReturn {
  return parseReviewReturn({ kind: REVIEW_RETURN_KIND, version: 1, id: `return_${crypto.randomUUID()}`,
    roundId, baselineDigest, createdAt: Date.now(), ...(comments?.threads.length ? { comments } : {}) });
}

export async function reviewReturnDigest(value: ReviewReturn): Promise<string> {
  return reviewPayloadDigest(parseReviewReturn(value));
}
