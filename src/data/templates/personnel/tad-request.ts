import type { LetterTemplate } from '../types';

export const tadRequest: LetterTemplate = {
  id: 'tad-request',
  name: 'Temporary Additional Duty (TAD) Request',
  category: 'Personnel',
  description: 'Request TAD orders for training, schools, or temporary assignment',
  docType: 'naval_letter',
  ssic: '1320',
  subject: 'REQUEST FOR TEMPORARY ADDITIONAL DUTY ORDERS',
  paragraphs: [
    { text: 'Request. Per reference (a), I request TAD orders for [RANK FULL NAME] to [DESTINATION/SCHOOL/UNIT] for the period of [START DATE] to [END DATE] ([NUMBER] days).', level: 0 },
    { text: 'Purpose. Purpose of TAD: [STATE PURPOSE - e.g., attendance at formal school, temporary augmentation, training exercise, inspection support, etc.]. [If school: Course number, class number, and report date].', level: 0 },
    { text: 'Justification. [EXPLAIN WHY THIS TAD IS NECESSARY. How does it support mission requirements or Marine\'s professional development? Why was this Marine selected?]', level: 0 },
    { text: 'Funding. Funding source: [SPECIFY - e.g., unit OPTAR, TECOM funded, gaining command funded, etc.]. Estimated cost: [AMOUNT] for travel, [AMOUNT] for per diem, [AMOUNT] total.', level: 0 },
    { text: 'Impact. [ADDRESS IMPACT ON UNIT. How will billet/duties be covered during absence? Any mission degradation concerns?]', level: 0 },
    { text: 'Point of Contact. Point of contact is SSgt J. Doe at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'JTR' },
  ],
};
