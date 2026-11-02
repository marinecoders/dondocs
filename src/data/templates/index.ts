import { emptyManualFrontMatter } from '@/data/techpub/manualFrontMatter';
import type { LetterTemplate } from './types';

// Personnel
import {
  pftWaiver,
  humanitarianTransfer,
} from './personnel';

// Awards
import {
  awardNam,
  awardLoa,
} from './awards';

// Leadership
import { commandInterest } from './leadership';

// Administrative
import {
  appointmentCollateralDuty,
  appointmentAcknowledgement,
  appointmentBoardMember,
  appointmentSafetyOfficer,
} from './administrative';

// Investigations
import {
  reportFindings,
  appointmentInvestigatingOfficer,
} from './investigations';

// Operations
import { letterOfInstructionOps } from './operations';

// Technical Publications
import { modificationInstruction, supplyInstruction, technicalInstruction, lubricationInstruction, sl3ComponentsList, sl4RepairPartsList } from './technical';

export const LETTER_TEMPLATES: LetterTemplate[] = [
  { id: 'tm-ietm-cover-signature', name: 'TM/IETM Cover and Signature Pages', category: 'Technical Publications',
    description: 'Cover, end-item continuation and authentication pages for a technical publication',
    docType: 'tm_ietm_front_matter', subject: '', paragraphs: [], manualFrontMatter: emptyManualFrontMatter() },
  // Personnel
  pftWaiver,
  humanitarianTransfer,
  // Awards
  awardNam,
  awardLoa,
  // Leadership
  commandInterest,
  // Administrative
  appointmentCollateralDuty,
  appointmentAcknowledgement,
  appointmentBoardMember,
  appointmentSafetyOfficer,
  // Investigations
  reportFindings,
  appointmentInvestigatingOfficer,
  // Operations
  letterOfInstructionOps,
  // Technical Publications
  modificationInstruction,
  supplyInstruction,
  technicalInstruction,
  lubricationInstruction,
  sl3ComponentsList,
  sl4RepairPartsList,
];

export type { LetterTemplate, TemplateParagraph, TemplateReference } from './types';
