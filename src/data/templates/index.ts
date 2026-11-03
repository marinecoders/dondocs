import type { LetterTemplate } from './types';

// Personnel
import {
  pftWaiver,
  humanitarianTransfer,
  recordsDiscrepancy,
  uaStatement,
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
  certificateOfRelief,
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
  recordsDiscrepancy,
  uaStatement,
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
  certificateOfRelief,
  // Investigations
  reportFindings,
  appointmentInvestigatingOfficer,
  // Operations
  letterOfInstructionOps,
];

export type { LetterTemplate, TemplateParagraph, TemplateReference } from './types';
