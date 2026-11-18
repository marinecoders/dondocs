import { z } from 'zod';

export const packageOutputDestinationSchema = z.object({
  memberId: z.string().min(1).max(100), label: z.string().min(1).max(120),
  startPage: z.number().int().positive(), pageCount: z.number().int().positive(),
  firstPageLabel: z.string().min(1).max(120), numbering: z.enum(['continuation', 'separate']),
}).strict();
export type PackageOutputDestination = z.infer<typeof packageOutputDestinationSchema>;

