import { z } from 'zod';
import { commentMessageSchema } from './reviewComments';
import { feedbackCategorySchema } from './reviewFeedback';
export const packagePdfRegionSchema = z.object({ left: z.number().min(0).max(1), top: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict()
  .refine(box => box.left + box.width <= 1 + 1e-9 && box.top + box.height <= 1 + 1e-9, 'Keep the region inside the captured page.');
export type PackagePdfRegion = z.infer<typeof packagePdfRegionSchema>;
export const packagePdfGeometrySchema = z.object({ x: z.number(), y: z.number(), width: z.number().positive().max(14400), height: z.number().positive().max(14400), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) }).strict();
export type PackagePdfGeometry = z.infer<typeof packagePdfGeometrySchema>;
export const packagePdfAnchorSchema = z.object({ assetSha256: z.string().regex(/^[a-f0-9]{64}$/), page: z.number().int().min(1).max(500), geometry: packagePdfGeometrySchema, region: packagePdfRegionSchema }).strict();
export type PackagePdfAnchor = z.infer<typeof packagePdfAnchorSchema>;
export const packagePdfCommentSchema = z.object({ id: z.string().uuid(), anchor: packagePdfAnchorSchema, category: feedbackCategorySchema,
  messages: z.array(commentMessageSchema).min(1).max(50), resolved: z.boolean() }).strict();
export type PackagePdfComment = z.infer<typeof packagePdfCommentSchema>;
export const packagePdfReviewSchema = z.object({ version: z.literal(1), comments: z.array(packagePdfCommentSchema).max(100) }).strict().superRefine((review, context) => {
  const ids = review.comments.flatMap(comment => [comment.id, ...comment.messages.map(message => message.id)]);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Duplicate PDF region feedback identity.' });
  if (new TextEncoder().encode(JSON.stringify(review)).byteLength > 512 * 1024) context.addIssue({ code: 'custom', message: 'PDF region feedback exceeds the 512 KB limit.' });
});
export type PackagePdfReview = z.infer<typeof packagePdfReviewSchema>;
