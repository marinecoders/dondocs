import { z } from 'zod';
import { MAX_WORD_REVIEW_HANDOFFS, validWordReviewPrefix, wordReviewHandoffSchema } from './wordReviewModel';
import { reviewCheckpointSchema, MAX_REVIEW_CHECKPOINTS, MAX_REVIEW_CHECKPOINT_BYTES, type ReviewCheckpoint } from './reviewCheckpointModel';
import type { SerializedSession } from '@/stores/documentStore';
import type { DocSnapshot } from './documentsDb';
import { parseSavedSession } from './savedSession';
import { supportsReviewComments } from './reviewCommentTargets';
import { idbReadReviewRound, idbReadReviewRounds, idbReadReviewCopy } from './documentsDb';

export const REVIEW_COPY_KIND = 'dondocs-review-copy';
export const MAX_REVIEW_COPY_BYTES = 100 * 1024 * 1024;
const identifier = z.string().min(1).max(200).refine(value => !Object.hasOwn(Object.prototype, value), 'Invalid document identity');
export const reviewRoundIdSchema = z.string().regex(/^review_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const reviewDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
export const reviewRoundEventSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(['active', 'closed', 'superseded']),
  changedAt: timestamp,
  replacementRoundId: reviewRoundIdSchema.optional(),
}).strict().refine(event => (event.state === 'superseded') === !!event.replacementRoundId,
  'Only a superseded round identifies a replacement.');
export const reviewRoundLifecycleSchema = z.object({
  events: z.array(reviewRoundEventSchema).min(1).max(100),
}).strict();

const session = z.unknown().transform((value, context): SerializedSession => {
  try {
    const raw = value as { enclosures?: Array<{ hasFile?: boolean; fileRef?: unknown }>; paragraphs?: Array<{ figure?: { fileRef?: unknown } }>; formData?: { basicLetterFile?: unknown; basicLetterFileRef?: unknown } };
    if (Array.isArray(raw?.enclosures) && raw.enclosures.some(enclosure => enclosure?.hasFile && !enclosure.fileRef)
      || Array.isArray(raw?.paragraphs) && raw.paragraphs.some(paragraph => paragraph?.figure && !paragraph.figure.fileRef)
      || raw?.formData?.basicLetterFile && !raw.formData.basicLetterFileRef) throw new Error('A required review asset has no retained reference.');
    const parsed = parseSavedSession(value);
    if (!supportsReviewComments(parsed)) throw new Error('Review rounds support native correspondence only.');
    return parsed;
  } catch {
    context.addIssue({ code: 'custom', message: 'Invalid native review baseline.' });
    return z.NEVER;
  }
});

interface ReviewRoundMetadata {
  id: string;
  createdAt: number;
  baselineDigest: string;
  lifecycle?: z.infer<typeof reviewRoundLifecycleSchema>;
  checkpoints?: ReviewCheckpoint[];
}

function validateReviewRoundMetadata(round: ReviewRoundMetadata, context: z.RefinementCtx) {
  const checkpoints = round.checkpoints ?? [];
  if (new Set(checkpoints.map(checkpoint => checkpoint.reviewerId)).size !== checkpoints.length
    || checkpoints.some(checkpoint => checkpoint.roundId !== round.id || checkpoint.baselineDigest !== round.baselineDigest)
    || new TextEncoder().encode(JSON.stringify(checkpoints)).byteLength > MAX_REVIEW_CHECKPOINT_BYTES) {
    context.addIssue({ code: 'custom', message: 'The round checkpoints are invalid or exceed their combined 2 MB limit.' });
  }
  let state: 'active' | 'closed' | 'superseded' = 'active';
  let changedAt = round.createdAt;
  const ids = new Set<string>();
  for (const event of round.lifecycle?.events ?? []) {
    const permitted = state === 'active' && event.state !== 'active'
      || state === 'closed' && event.state === 'active';
    if (!permitted || event.changedAt < changedAt || event.replacementRoundId === round.id || ids.has(event.id)) {
      context.addIssue({ code: 'custom', message: 'The review lifecycle history is inconsistent.' });
    }
    ids.add(event.id);
    state = event.state;
    changedAt = event.changedAt;
  }
}

/** The baseline uses the same saved snapshot and immutable attachment handles as History. */
export const reviewRoundSchema = z.object({
  kind: z.literal('dondocs-review-round'), version: z.literal(1),
  id: reviewRoundIdSchema, createdAt: timestamp, label: z.string().min(1).max(120),
  sourceDocumentId: identifier, baselineDigest: reviewDigestSchema,
  baseline: z.object({ ts: timestamp, session }).strict(),
  // Set only by local creation or an explicit workspace backup restore. A
  // portable reviewer copy never supplies local owner authority.
  ownerDocumentId: identifier.optional(),
  wordHandoffs: z.array(wordReviewHandoffSchema).max(MAX_WORD_REVIEW_HANDOFFS).optional(),
  lifecycle: reviewRoundLifecycleSchema.optional(),
  checkpoints: z.array(reviewCheckpointSchema).max(MAX_REVIEW_CHECKPOINTS).optional(),
}).strict().refine(round => round.createdAt === round.baseline.ts && round.baseline.session.timestamp === round.baseline.ts,
  'Review baseline timestamps do not match.').superRefine(validateReviewRoundMetadata).superRefine((round, context) => {
  const handoffs = round.wordHandoffs ?? [];
  if (handoffs.length && (!round.ownerDocumentId || new Set(handoffs.map(item => item.id)).size !== handoffs.length
    || new TextEncoder().encode(JSON.stringify(handoffs)).byteLength > 2 * 1024 * 1024)) context.addIssue({ code: 'custom', message: 'Word handoffs require bounded locally owned issued receipts.' });
  for (const handoff of handoffs) {
    if (handoff.createdAt < round.createdAt) context.addIssue({ code: 'custom', message: 'The Word handoff predates its native baseline.' });
    for (const block of handoff.blocks) if (block.kind === 'paragraph') {
      const matches = round.baseline.session.paragraphs.filter(paragraph => paragraph.id === block.paragraphId);
      if (matches.length !== 1 || !matches[0].text.trim() || matches[0].figure || matches[0].bodyTable || matches[0].tableKey || matches[0].callout || matches[0].procedure || matches[0].appendix
        || !validWordReviewPrefix(block.prefix, matches[0])) context.addIssue({ code: 'custom', message: 'A Word handoff binding differs from its retained native paragraph.' });
    }
  }
});
export type ReviewRound = z.infer<typeof reviewRoundSchema>;

export function reviewRoundStatus(round: ReviewRound): 'active' | 'closed' | 'superseded' {
  return round.lifecycle?.events.at(-1)?.state ?? 'active';
}

export function assertActiveReviewRound(round: ReviewRound): void {
  if (reviewRoundStatus(round) !== 'active') {
    throw new Error('This review round is closed or superseded. Keep the returned file. Reopen a closed round deliberately, or request feedback for its replacement.');
  }
}

export const reviewCopyLinkSchema = z.object({
  documentId: identifier, roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
}).strict();
export type ReviewCopyLink = z.infer<typeof reviewCopyLinkSchema>;

export const reviewCopyEnvelopeSchema = z.object({
  kind: z.literal(REVIEW_COPY_KIND), version: z.literal(1),
  round: z.object({
    id: reviewRoundIdSchema, createdAt: timestamp, label: z.string().min(1).max(120),
    sourceDocumentId: identifier, baselineDigest: reviewDigestSchema,
    lifecycle: reviewRoundLifecycleSchema.optional(),
    checkpoints: z.array(reviewCheckpointSchema).max(MAX_REVIEW_CHECKPOINTS).optional(),
  }).strict().superRefine(validateReviewRoundMetadata),
  // This is the existing portable draft-file format, not another document model.
  draft: z.unknown(),
}).strict();
export type ReviewCopyEnvelope = z.infer<typeof reviewCopyEnvelopeSchema>;

export function parseReviewRound(value: unknown): ReviewRound {
  const parsed = reviewRoundSchema.safeParse(value);
  if (!parsed.success) throw new Error('A saved review baseline is invalid. Recover it from an intact workspace backup before sending it.');
  return parsed.data;
}

/** Stable object ordering binds exactly the captured portable payload, including its bytes. */
export function canonicalReviewPayload(value: unknown): string {
  let nodes = 0;
  const canonical = (item: unknown, depth = 0): unknown => {
    if (++nodes > 100_000 || depth > 50) throw new Error('This review copy is too complex.');
    if (Array.isArray(item)) return item.map(child => canonical(child, depth + 1));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item)
      .filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonical(child, depth + 1)]));
    if (typeof item === 'number' && !Number.isFinite(item) || ['bigint', 'function', 'symbol'].includes(typeof item)) throw new Error('Invalid review copy content.');
    return item;
  };
  const encoded = JSON.stringify(canonical(value));
  if (typeof encoded !== 'string') throw new Error('Invalid review copy content.');
  return encoded;
}

export async function reviewPayloadDigest(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Review revision checks require HTTPS or localhost. Ordinary draft files are still available.');
  const encoded = new TextEncoder().encode(canonicalReviewPayload(value));
  if (encoded.byteLength > MAX_REVIEW_COPY_BYTES) throw new Error('This review copy exceeds the 100 MB transfer limit.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoded))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function reviewBaseline(round: ReviewRound): DocSnapshot {
  return structuredClone(round.baseline);
}

export async function readReviewRound(id: string): Promise<ReviewRound | null> {
  const value = await idbReadReviewRound(reviewRoundIdSchema.parse(id));
  return value === null ? null : parseReviewRound(value);
}

export async function listReviewRounds(): Promise<ReviewRound[]> {
  return (await idbReadReviewRounds()).map(parseReviewRound);
}

export async function readReviewCopyLink(documentId: string): Promise<ReviewCopyLink | null> {
  const value = await idbReadReviewCopy(identifier.parse(documentId));
  return value === null ? null : reviewCopyLinkSchema.parse(value);
}
