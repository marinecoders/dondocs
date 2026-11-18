import { z } from 'zod';
import { packageBindingTargetSchema, packageBindingValueSchema } from './packageBindingTargets';
import { commentMessageSchema } from './reviewComments';
import { feedbackCategorySchema } from './reviewFeedback';

/** Field identity includes the pinned definition and stable row ID, never a visible ordinal. */
export const packageFormAnchorSchema = z.object({
  target: packageBindingTargetSchema.refine(target => target.kind !== 'correspondence', 'Choose a supported form field.'),
  label: z.string().min(1).max(240),
  kind: z.enum(['text', 'identifier', 'date', 'decimal', 'boolean', 'singleChoice']),
  context: packageBindingValueSchema,
}).strict();
export type PackageFormAnchor = z.infer<typeof packageFormAnchorSchema>;
export const packageFormCommentSchema = z.object({
  id: z.string().uuid(), anchor: packageFormAnchorSchema, category: feedbackCategorySchema,
  messages: z.array(commentMessageSchema).min(1).max(50), resolved: z.boolean(),
}).strict();
export type PackageFormComment = z.infer<typeof packageFormCommentSchema>;
export const packageFormReviewSchema = z.object({
  version: z.literal(1), comments: z.array(packageFormCommentSchema).max(100),
}).strict().superRefine((review, context) => {
  const identities = review.comments.flatMap(comment => [comment.id, ...comment.messages.map(message => message.id)]);
  if (new Set(identities).size !== identities.length) context.addIssue({ code: 'custom', message: 'Duplicate form feedback identity.' });
  if (new TextEncoder().encode(JSON.stringify(review)).byteLength > 512 * 1024)
    context.addIssue({ code: 'custom', message: 'Form feedback exceeds the 512 KB limit.' });
});
export type PackageFormReview = z.infer<typeof packageFormReviewSchema>;
