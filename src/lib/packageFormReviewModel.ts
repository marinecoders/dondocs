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
export const packageFormProposalSchema = z.object({
  id: z.string().uuid(), anchor: packageFormAnchorSchema, author: z.string().trim().min(1).max(100),
  value: z.union([z.string().max(10000), z.boolean()]), createdAt: z.string().datetime(),
  reason: z.string().max(2000).optional(),
}).strict();
export type PackageFormProposal = z.infer<typeof packageFormProposalSchema>;
const receiptIdentity = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
export const packageFieldReviewApplicationSchema = z.object({
  id: receiptIdentity, roundId: receiptIdentity, memberId: receiptIdentity,
  beforeRevisionId: receiptIdentity, revisionId: receiptIdentity, createdAt: z.number().int().nonnegative(),
  action: z.enum(['accepted', 'rejected', 'undo']), mode: z.enum(['local', 'shared']),
  proposal: packageFormProposalSchema, before: packageBindingValueSchema, after: packageBindingValueSchema,
  undoOf: receiptIdentity.optional(),
}).strict().refine(value => (value.action === 'undo') === !!value.undoOf, 'Undo must identify its retained decision.');
export type PackageFieldReviewApplication = z.infer<typeof packageFieldReviewApplicationSchema>;
export const packageFormReviewSchema = z.object({
  version: z.literal(1), comments: z.array(packageFormCommentSchema).max(100),
  proposals: z.array(packageFormProposalSchema).max(100).optional(),
}).strict().superRefine((review, context) => {
  const identities = [...review.comments.flatMap(comment => [comment.id, ...comment.messages.map(message => message.id)]), ...(review.proposals ?? []).map(proposal => proposal.id)];
  if (new Set(identities).size !== identities.length) context.addIssue({ code: 'custom', message: 'Duplicate form feedback identity.' });
  if (new TextEncoder().encode(JSON.stringify(review)).byteLength > 512 * 1024)
    context.addIssue({ code: 'custom', message: 'Form feedback exceeds the 512 KB limit.' });
});
export type PackageFormReview = z.infer<typeof packageFormReviewSchema>;

/** Inspect raw strings so multiline handling markings cannot hide in JSON escaping. */
export function packageFormFeedbackText(value: unknown): string {
  const strings: string[] = [];
  const collect = (item: unknown): void => {
    if (typeof item === 'string') strings.push(item);
    else if (Array.isArray(item)) item.forEach(collect);
    else if (item && typeof item === 'object') Object.values(item).forEach(collect);
  };
  collect(value); return strings.join('\n');
}
