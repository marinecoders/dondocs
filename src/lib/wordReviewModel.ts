import { z } from 'zod';
import { paragraphIdSchema } from './paragraphIdentity';
import { readWordPrintedCounter } from '@/services/docx/import/printedCounter';
import type { Paragraph } from '@/types/document';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const index = z.number().int().min(0).max(50_000);
const opaque = z.object({ kind: z.literal('opaque'), sourceIndex: index, digest }).strict();
const paragraph = z.object({ kind: z.literal('paragraph'), sourceIndex: index, paragraphId: paragraphIdSchema,
  prefix: z.string().max(2_000), plainPrefixLength: z.number().int().min(0).max(2_000), beforePlainDigest: digest }).strict();
export const wordReviewHandoffSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), createdAt: z.number().int().nonnegative().max(8_640_000_000_000_000),
  docxSha256: digest, staticDigest: digest, blocks: z.array(z.discriminatedUnion('kind', [opaque, paragraph])).min(1).max(1_000),
}).strict().superRefine((value, context) => {
  if (value.blocks.some((block, position) => position > 0 && block.sourceIndex < value.blocks[position - 1].sourceIndex)) context.addIssue({ code: 'custom', message: 'Word review bindings are out of source order.' });
  const paragraphs = value.blocks.filter(block => block.kind === 'paragraph');
  if (!paragraphs.length || new Set(paragraphs.map(block => block.paragraphId)).size !== paragraphs.length
    || new Set(paragraphs.map(block => block.sourceIndex)).size !== paragraphs.length
    || paragraphs.reduce((size, block) => size + block.prefix.length, 0) > 200_000) context.addIssue({ code: 'custom', message: 'Word review bindings are missing, duplicated or oversized.' });
});
export type WordReviewHandoff = z.infer<typeof wordReviewHandoffSchema>;
export type WordReviewParagraphBinding = Extract<WordReviewHandoff['blocks'][number], { kind: 'paragraph' }>;
export const MAX_WORD_REVIEW_HANDOFFS = 10;

const normalizePrefix = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
/** Receipt prefixes may contain only native heading/portion text and the
 * recognized generated counter; they cannot introduce hidden retained prose. */
export function validWordReviewPrefix(prefix: string, paragraph: Paragraph): boolean {
  const counter = readWordPrintedCounter(prefix), body = prefix.slice(counter?.serializedLength ?? 0);
  if (counter && counter.level !== paragraph.level) return false;
  const actual = normalizePrefix(body), portion = normalizePrefix(paragraph.portionMarking ?? '');
  return actual === portion || actual === normalizePrefix((paragraph.header ?? '') + (paragraph.portionMarking ?? ''));
}
