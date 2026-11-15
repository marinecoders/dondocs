import { z } from 'zod';

export const MAX_REVIEW_CHECKPOINT_BYTES = 2 * 1024 * 1024;
export const MAX_REVIEW_CHECKPOINTS = 25;
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const checkpointFieldSchema = z.object({
  key: z.string().min(1).max(1_000),
  label: z.string().min(1).max(1_000),
  value: z.string().max(200_000),
}).strict();

const checkpointDocumentFieldSchema = checkpointFieldSchema.refine(field => {
  try {
    const path: unknown = JSON.parse(field.key);
    return Array.isArray(path) && path.length > 0 && path.length <= 50
      && path.every(part => typeof part === 'string' || typeof part === 'number' && Number.isSafeInteger(part) && part >= 0)
      && JSON.stringify(path) === field.key;
  } catch { return false; }
}, 'Checkpoint document fields require canonical structured paths.');

const checkpointMarkingSchema = z.object({
  classLevel: z.string().max(100).optional(),
  customClassification: z.string().max(200_000).optional(),
  portionMarking: z.string().max(200_000).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'An empty marking context is invalid.');

/** A comparison checkpoint owns text and metadata, never editable document or file bytes. */
export const reviewCheckpointSchema = z.object({
  kind: z.literal('dondocs-review-checkpoint'),
  version: z.literal(1),
  id: z.string().uuid(),
  reviewerId: z.string().uuid(),
  reviewerLabel: z.string().trim().min(1).max(100),
  roundId: z.string().regex(/^review_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  baselineDigest: digest,
  capturedAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  document: z.array(checkpointDocumentFieldSchema).max(5_000),
  feedback: z.array(checkpointFieldSchema).max(20_000),
  markings: z.array(checkpointMarkingSchema).max(10_000),
  digest,
}).strict().superRefine((checkpoint, context) => {
  for (const fields of [checkpoint.document, checkpoint.feedback]) {
    if (new Set(fields.map(field => field.key)).size !== fields.length) {
      context.addIssue({ code: 'custom', message: 'Checkpoint field identities must be unique.' });
    }
  }
  if (new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > MAX_REVIEW_CHECKPOINT_BYTES) {
    context.addIssue({ code: 'custom', message: 'The checkpoint exceeds its 2 MB limit.' });
  }
});
export type ReviewCheckpoint = z.infer<typeof reviewCheckpointSchema>;
export type CheckpointField = ReviewCheckpoint['document'][number];
