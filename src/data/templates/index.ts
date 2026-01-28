import type { LetterTemplate } from './types';

// Personnel
import {
  requestMast,
  page11Request,
  pftWaiver,
  ordersModification,
  humanitarianTransfer,
  careerDesignation,
  tadRequest,
} from './personnel';

// Awards
import {
  awardNam,
  awardLoa,
  meritoriousPromo,
  meritoriousMast,
} from './awards';

// Leadership
import {
  counselingPositive,
  counselingNegative,
  commandInterest,
  loi,
} from './leadership';

// Endorsements
import {
  endorsementApprove,
  endorsementDisapprove,
  endorsementInfo,
  extensionEndorsement,
} from './endorsements';

// Administrative
import {
  checkoutLetter,
  appointmentCollateralDuty,
  appointmentBoardMember,
  dutyStatusChange,
  appointmentSafetyOfficer,
} from './administrative';

// Investigations
import {
  reportFindings,
  appointmentInvestigatingOfficer,
} from './investigations';

// Legal
import { legalHold, notarizedStatement } from './legal';

// Memoranda
import { mfrMeeting } from './memoranda';

// Operations
import { letterOfInstructionOps } from './operations';

export const LETTER_TEMPLATES: LetterTemplate[] = [
  // Personnel
  requestMast,
  page11Request,
  pftWaiver,
  ordersModification,
  humanitarianTransfer,
  careerDesignation,
  tadRequest,
  // Awards
  awardNam,
  awardLoa,
  meritoriousPromo,
  meritoriousMast,
  // Leadership
  counselingPositive,
  counselingNegative,
  commandInterest,
  loi,
  // Endorsements
  endorsementApprove,
  endorsementDisapprove,
  endorsementInfo,
  extensionEndorsement,
  // Administrative
  checkoutLetter,
  appointmentCollateralDuty,
  appointmentBoardMember,
  dutyStatusChange,
  appointmentSafetyOfficer,
  // Investigations
  reportFindings,
  appointmentInvestigatingOfficer,
  // Legal
  legalHold,
  notarizedStatement,
  // Memoranda
  mfrMeeting,
  // Operations
  letterOfInstructionOps,
];

export type { LetterTemplate, TemplateParagraph, TemplateReference } from './types';
