import { z } from 'zod';

export const wordSourceSchema = z.object({
  name: z.string().min(1).max(255), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  notices: z.array(z.string().max(1_000)).max(30), retainedText: z.string().max(200_000),
  fileRef: z.object({ id: z.string().min(1).max(200), name: z.string().max(255), size: z.number().int().min(0).max(20 * 1024 * 1024), type: z.string().max(150) }).optional(),
}).strict();
export type WordSourceMetadata = z.infer<typeof wordSourceSchema>;
