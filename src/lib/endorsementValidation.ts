import { z } from 'zod';

/** Shared links and backups must reject malformed editor rows before loading. */
const endorsement = z.object({
  id: z.string().min(1),
  endorsementFrom: z.string().optional(),
  endorsementTo: z.string().optional(),
  endorsementBody: z.string().optional(),
  endorsementSigFirst: z.string().optional(),
  endorsementSigMiddle: z.string().optional(),
  endorsementSigLast: z.string().optional(),
  endorsementSerial: z.string().optional(),
  endorsementDate: z.string().optional(),
});

export const additionalEndorsementsSchema = z.array(endorsement).max(9).refine(
  (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
  'Endorsement IDs must be unique',
);
