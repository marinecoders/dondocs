import { z } from 'zod';

export const packageOutputDestinationSchema = z.object({
  memberId: z.string().min(1).max(100), label: z.string().min(1).max(120),
  startPage: z.number().int().positive(), pageCount: z.number().int().positive(),
  firstPageLabel: z.string().min(1).max(120), numbering: z.enum(['continuation', 'separate']),
}).strict();
export type PackageOutputDestination = z.infer<typeof packageOutputDestinationSchema>;


export const packageAssemblySettingsSchema = z.object({
  version: z.literal(1), profile: z.enum(['letter-led', 'forms-led', 'mixed']),
  cover: z.boolean(), contents: z.boolean(), samePageEndorsements: z.boolean(),
}).strict();
export type PackageAssemblySettings = z.infer<typeof packageAssemblySettingsSchema>;
export const defaultPackageAssemblySettings = (): PackageAssemblySettings => ({ version: 1, profile: 'mixed', cover: false, contents: false, samePageEndorsements: false });
export const packageAssemblyResultSchema = z.object({
  version: z.literal(1), profile: z.enum(['letter-led', 'forms-led', 'mixed']), frontMatterPages: z.number().int().min(0).max(100),
}).strict();
