import { z } from 'zod';
import { BODY_TABLE_LIMITS } from './bodyTable';

export const MAX_COORDINATION_OFFICES = BODY_TABLE_LIMITS.rows - 1;
export const COORDINATION_FIELD_LENGTH = Math.floor(BODY_TABLE_LIMITS.characters / MAX_COORDINATION_OFFICES / 5) - 5;

const officeField = z.string().max(COORDINATION_FIELD_LENGTH);
const coordinationEntry = z.object({
  office: officeField,
  contact: officeField,
  phone: officeField,
  date: officeField,
  position: officeField,
});

export const staffPaperFields = z.object({
  staffApprovedBy: z.string().max(500).optional(),
  staffDecisionOptions: z.string().max(4_000).optional(),
  staffDecisionOfficials: z.string().max(1_000).optional(),
  staffDecisionStyle: z.enum(['single', 'choose_one', 'independent']).optional(),
  coordinationLayout: z.enum(['secnav', 'hqmc']).optional(),
  coordinationEntries: z.array(coordinationEntry).max(MAX_COORDINATION_OFFICES).optional(),
  coordinationComments: z.string().max(8_000).optional(),
});
