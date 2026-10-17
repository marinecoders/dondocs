import { z } from 'zod';
import type { Profile } from '@/types/document';

const profileSchema = z.object({
  department: z.string().optional(),
  unitLine1: z.string(), unitLine2: z.string(), unitAddress: z.string(),
  ssic: z.string(), from: z.string(), sigFirst: z.string(), sigMiddle: z.string(),
  sigLast: z.string(), sigRank: z.string(), sigTitle: z.string(),
  officeCode: z.string().optional(), byDirection: z.boolean().optional(),
  byDirectionAuthority: z.string().optional(), cuiControlledBy: z.string().optional(),
  pocEmail: z.string().optional(), signatureType: z.enum(['none', 'image', 'digital']).optional(),
  signatureImage: z.object({ name: z.string(), size: z.number().nonnegative(), data: z.string() }).optional(),
});

export function parseProfileImport(value: unknown): Record<string, Profile> {
  const result = z.object({ profiles: z.record(z.string().min(1).refine((name) => name.trim().length > 0 && !['__proto__', 'constructor', 'prototype'].includes(name)), profileSchema) }).safeParse(value);
  if (!result.success || !Object.keys(result.data.profiles).length) {
    throw new Error('Choose a DonDocs profiles JSON file with valid profile details.');
  }
  return result.data.profiles;
}
