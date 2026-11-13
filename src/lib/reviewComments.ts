import { z } from 'zod';

export const COMMENT_LIMITS = { threads: 100, messages: 50, author: 100, text: 10_000, context: 20_000, totalCharacters: 200_000 } as const;
const identifier = z.string().uuid();
const context = z.string().max(COMMENT_LIMITS.context);
export const commentAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('document') }).strict(),
  z.object({ kind: z.literal('field'), field: z.string().regex(/^[a-z][A-Za-z0-9]*$/).max(100),
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
  resolved: z.boolean(),
}).strict();
export type CommentThread = z.infer<typeof commentThreadSchema>;
export const reviewCommentsSchema = z.object({ version: z.literal(1), threads: z.array(commentThreadSchema).max(COMMENT_LIMITS.threads) })
  .strict().superRefine((value, ctx) => {
    const ids = new Set<string>();
    let characters = 0;
    for (const thread of value.threads) {
      for (const id of [thread.id, ...thread.messages.map(message => message.id)]) {
        if (ids.has(id)) ctx.addIssue({ code: 'custom', message: 'Comment IDs must be unique.' });
        ids.add(id);
      }
      if (thread.anchor.kind === 'field') characters += thread.anchor.context.length;
      for (const message of thread.messages) characters += message.author.length + message.text.length;
    }
    if (characters > COMMENT_LIMITS.totalCharacters) ctx.addIssue({ code: 'custom', message: 'The comments exceed the supported text limit.' });
  });
export type ReviewComments = z.infer<typeof reviewCommentsSchema>;

export function hasReviewComments(source: { reviewComments?: ReviewComments }): boolean {
  return !!source.reviewComments?.threads.length;
}
