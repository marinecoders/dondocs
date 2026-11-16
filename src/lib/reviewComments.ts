import { z } from 'zod';
import { selectedTextRangeSchema } from './reviewTextRanges';
import { paragraphIdSchema } from './paragraphIdentity';
import { feedbackCategorySchema } from './reviewFeedback';

export const COMMENT_LIMITS = { threads: 100, messages: 50, author: 100, text: 10_000, context: 20_000, totalCharacters: 200_000 } as const;
const identifier = z.string().uuid();
const context = z.string().max(COMMENT_LIMITS.context);
export const commentAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('document') }).strict(),
  selectedTextRangeSchema,
  z.object({ kind: z.literal('field'), field: z.string().regex(/^[a-z][A-Za-z0-9]*$/).max(100),
    context, docType: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('paragraph'), paragraphId: paragraphIdSchema,
    context, docType: z.string().min(1).max(100) }).strict(),
]);
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;
export const commentMessageSchema = z.object({
  id: identifier, author: z.string().trim().min(1).max(COMMENT_LIMITS.author),
  text: z.string().max(COMMENT_LIMITS.text).refine(value => /\S/.test(value), 'Enter a comment.'),
  createdAt: z.string().datetime(), editedAt: z.string().datetime().optional(),
}).strict();
export type CommentMessage = z.infer<typeof commentMessageSchema>;
export const commentThreadSchema = z.object({
  id: identifier, anchor: commentAnchorSchema, messages: z.array(commentMessageSchema).min(1).max(COMMENT_LIMITS.messages),
  anchorHistory: z.array(z.object({ anchor: selectedTextRangeSchema, reattachedAt: z.string().datetime() }).strict()).max(10).optional(),
  resolved: z.boolean(), category: feedbackCategorySchema.optional(),
}).strict();
export type CommentThread = z.infer<typeof commentThreadSchema>;
export const reviewCommentsSchema = z.object({ version: z.union([z.literal(1), z.literal(2), z.literal(3)]), threads: z.array(commentThreadSchema).max(COMMENT_LIMITS.threads) })
  .strict().superRefine((value, ctx) => {
    const ids = new Set<string>();
    let characters = 0;
    for (const thread of value.threads) {
      for (const id of [thread.id, ...thread.messages.map(message => message.id)]) {
        if (ids.has(id)) ctx.addIssue({ code: 'custom', message: 'Comment IDs must be unique.' });
        ids.add(id);
      }
      if (thread.anchor.kind !== 'document') characters += thread.anchor.context.length;
      if (thread.anchor.kind === 'range') {
        characters += (thread.anchor.tracking?.context.length ?? 0) + (thread.anchor.tracking?.paragraphId?.length ?? 0);
        if (value.version !== 3 || thread.anchor.start === thread.anchor.end) ctx.addIssue({ code: 'custom', message: 'Selected-text comments require a nonempty range and review format version 3.' });
      }
      if (thread.anchor.kind === 'paragraph' && value.version === 1) ctx.addIssue({ code: 'custom', message: 'Paragraph comments require review format version 2.' });
      if (thread.anchorHistory !== undefined && (value.version !== 3 || thread.anchor.kind !== 'range')) ctx.addIssue({ code: 'custom', message: 'Reattachment history requires selected-text comments in format version 3.' });
      for (const previous of thread.anchorHistory ?? []) {
        characters += previous.anchor.context.length + (previous.anchor.tracking?.context.length ?? 0) + (previous.anchor.tracking?.paragraphId?.length ?? 0);
        if (value.version !== 3 || previous.anchor.start === previous.anchor.end || thread.anchor.kind !== 'range') ctx.addIssue({ code: 'custom', message: 'Reattachment history requires selected-text comments in format version 3.' });
      }
      for (const message of thread.messages) characters += message.author.length + message.text.length;
    }
    if (characters > COMMENT_LIMITS.totalCharacters) ctx.addIssue({ code: 'custom', message: 'The comments exceed the supported text limit.' });
  });
export type ReviewComments = z.infer<typeof reviewCommentsSchema>;

export function hasReviewComments(source: { reviewComments?: ReviewComments }): boolean {
  return !!source.reviewComments?.threads.length;
}

export function reviewCommentsVersion(threads: readonly CommentThread[]): ReviewComments['version'] {
  return threads.some(thread => thread.anchor.kind === 'range') ? 3 : threads.some(thread => thread.anchor.kind === 'paragraph') ? 2 : 1;
}
