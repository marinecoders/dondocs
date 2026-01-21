import type { LetterTemplate } from '../types';

export const ordersModification: LetterTemplate = {
  id: 'orders-modification',
  name: 'Request for Orders Modification',
  category: 'Personnel',
  description: 'Request to modify PCS or TAD orders',
  docType: 'naval_letter',
  ssic: '1320',
  subject: 'REQUEST FOR ORDERS MODIFICATION',
  paragraphs: [
    { text: 'Request. Per reference (a), I request modification to my orders [ORDER NUMBER] dated [DATE].', level: 0 },
    { text: 'Current Orders. I am currently ordered to report to [GAINING UNIT] NLT [REPORT DATE] for duty as [BILLET].', level: 0 },
    { text: 'Requested Modification. [Clearly state the specific modification requested: change of report date, change of duty station, deletion of dependent travel, etc.]', level: 0 },
    { text: 'Justification. [Provide detailed justification for the modification request. Include any extenuating circumstances or hardship factors.]', level: 0 },
    { text: 'Impact. [Address how this modification will or will not impact the gaining unit or Marine Corps manning requirements.]', level: 0 },
    { text: 'Point of Contact. Point of contact is the undersigned at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1320.11' },
  ],
};
