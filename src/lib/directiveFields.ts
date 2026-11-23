import { z } from 'zod';
export const directiveFields = z.object({
  directiveNumber: z.string().max(120).optional(),
  directiveCancellation: z.string().max(120).optional(),
  directiveChangeNumber: z.string().max(10).optional(),
  directiveReports: z.string().max(4_000).optional(),
});
