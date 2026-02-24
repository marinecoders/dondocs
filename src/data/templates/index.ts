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

export const LETTER_TEMPLATES: LetterTemplate[] = [
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
  appointmentBoardMember,
  appointmentSafetyOfficer,
  // Investigations
  reportFindings,
  appointmentInvestigatingOfficer,
  // Operations
  letterOfInstructionOps,
];

export type { LetterTemplate, TemplateParagraph, TemplateReference } from './types';
