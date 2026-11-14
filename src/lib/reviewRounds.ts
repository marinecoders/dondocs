import { z } from 'zod';
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

/** The baseline uses the same saved snapshot and immutable attachment handles as History. */
export const reviewRoundSchema = z.object({
  kind: z.literal('dondocs-review-round'), version: z.literal(1),
  id: reviewRoundIdSchema, createdAt: timestamp, label: z.string().min(1).max(120),
  sourceDocumentId: identifier, baselineDigest: reviewDigestSchema,
  baseline: z.object({ ts: timestamp, session }).strict(),
  // Set only by local creation or an explicit workspace backup restore. A
  // portable reviewer copy never supplies local owner authority.
  ownerDocumentId: identifier.optional(),
}).strict().refine(round => round.createdAt === round.baseline.ts && round.baseline.session.timestamp === round.baseline.ts,
  'Review baseline timestamps do not match.');
export type ReviewRound = z.infer<typeof reviewRoundSchema>;

export const reviewCopyLinkSchema = z.object({
  documentId: identifier, roundId: reviewRoundIdSchema, baselineDigest: reviewDigestSchema,
}).strict();
export type ReviewCopyLink = z.infer<typeof reviewCopyLinkSchema>;

export const reviewCopyEnvelopeSchema = z.object({
  kind: z.literal(REVIEW_COPY_KIND), version: z.literal(1),
  round: z.object({
    id: reviewRoundIdSchema, createdAt: timestamp, label: z.string().min(1).max(120),
    sourceDocumentId: identifier, baselineDigest: reviewDigestSchema,
  }).strict(),
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
