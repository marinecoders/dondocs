import type { LetterTemplate } from './types';

// Personnel
import {
  leaveRequest,
  specialLiberty,
  requestMast,
  page11Request,
  fitrepCover,
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
  personalAwardRecommendation,
} from './awards';

// Leadership
import {
  counselingPositive,
  counselingNegative,
  commandInterest,
  entry6105,
  loi,
} from './leadership';

// Endorsements
import {
  endorsementApprove,
  endorsementDisapprove,
  endorsementInfo,
  extensionEndorsement,
} from './endorsements';

// Training
import { trainingRequest } from './training';

// Administrative
import {
  gtccRequest,
  checkoutLetter,
  sgliUpdate,
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
  leaveRequest,
  specialLiberty,
  requestMast,
  page11Request,
  fitrepCover,
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
  personalAwardRecommendation,
  // Leadership
  counselingPositive,
  counselingNegative,
  commandInterest,
  entry6105,
  loi,
  // Endorsements
  endorsementApprove,
  endorsementDisapprove,
  endorsementInfo,
  extensionEndorsement,
  // Training
  trainingRequest,
  // Administrative
  gtccRequest,
  checkoutLetter,
  sgliUpdate,
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
