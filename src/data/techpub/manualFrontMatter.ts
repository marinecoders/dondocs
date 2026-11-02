import { z } from 'zod';

export const MANUAL_TYPES = {
  tm: ['TECHNICAL MANUAL', 'Technical Manual', 'TM'],
  cots: ['COMMERCIAL OFF-THE-SHELF', 'Commercial Off-The-Shelf', 'TM'],
  qrg: ['QUICK REFERENCE GUIDE', 'Quick Reference Guide', 'TM'],
  rpstl: ['REPAIR PARTS & SPECIAL TOOLS LIST', 'Repair Parts and Special Tool List', 'TM'],
  supplement: ['SUPPLEMENT', 'Supplement', 'TM'],
  tm_rpstl: ['TECHNICAL MANUAL WITH RPSTL', 'Technical Manual with Repair Parts and Special Tools List', 'TM'],
  user: ['USER MANUAL', 'User Manual', 'TM'],
  ietm: ['INTERACTIVE ELECTRONIC TECHNICAL MANUAL', 'Interactive Electronic Technical Manual', 'TM'],
} as const;

export const manualFrontMatterSchema = z.object({
  subtype: z.enum(['tm', 'cots', 'qrg', 'rpstl', 'supplement', 'tm_rpstl', 'user', 'ietm']).default('tm'),
  service: z.enum(['UNITED STATES MARINE CORPS', 'UNITED STATES NAVY']).default('UNITED STATES MARINE CORPS'),
  maintenanceLevel: z.string().default(''),
  subtitle: z.string().default(''),
  shortTitleBasis: z.enum(['marine_corps', 'sponsor_assigned']).default('marine_corps'),
  shortTitleApproval: z.string().default(''),
  authorityBasis: z.enum(['unconfirmed', 'pm_or_above', 'pdm_deviation', 'other_approved']).default('unconfirmed'),
  authorityReference: z.string().default(''),
  rightsAssessment: z.enum(['unreviewed', 'not_required', 'limited_rights']).default('unreviewed'),
  volume: z.string().default(''),
  volumes: z.string().default(''),
  volumeNotice: z.string().default(''),
  supplementNotice: z.string().default(''),
  copyrightCredit: z.string().default(''),
  governmentRights: z.string().default('').describe('Owner- or contract-approved government rights to publish, reproduce and distribute; required when copyright credit is supplied.'),
  contentContact: z.string().default(''),
  dfarClause: z.enum(['none', '252.227-7013', '252.227-7015']).default('none'),
  endItems: z.array(z.object({
    rowId: z.string().min(1),
    nsn: z.string(), tamcn: z.string(), id: z.string(), model: z.string(),
  }).strict()).default([]),
}).strict();

export type ManualFrontMatter = z.infer<typeof manualFrontMatterSchema>;
export const emptyManualFrontMatter = (): ManualFrontMatter => manualFrontMatterSchema.parse({});
export const MANUAL_DOC_TYPE = 'tm_ietm_front_matter';
export const MANUAL_SECTION_IDS = ['manual-publication', 'manual-items', 'manual-notices', 'manual-authentication'] as const;

export function manualType(subtype: ManualFrontMatter['subtype']) {
  const type = MANUAL_TYPES[subtype];
  if (!type) throw new Error('Select a supported TM/IETM publication type.');
  return type;
}

export const ISSUING_ENTITIES = [
  'Portfolio Acquisition Executive Marine Corps',
  'Portfolio Acquisition Executive Mission Systems',
] as const;
export const ISSUING_ADDRESSES = [
  '2200 Lester Street\nQuantico, VA 22134-5050',
  'BLDG 196, Suite 400\nWashington, DC 20374-5147',
] as const;

export const CONTROLLING_OFFICES = [
  'Advanced Amphibious Assault', 'Combat Support System', 'Expeditionary Radars',
  'Ground Based Air Defense', 'Ground Weapons Systems', 'Intelligence & Cyberspace Operations',
  'Light Armored Vehicles', 'Marine Air-Ground Task Force Command & Control',
  'Motor Transport', 'Tactical Communications & Electromagnetic Warfare Systems',
  'Training Systems', 'Wargaming',
] as const;
