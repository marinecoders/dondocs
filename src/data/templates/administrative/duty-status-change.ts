import type { LetterTemplate } from '../types';

export const dutyStatusChange: LetterTemplate = {
  id: 'duty-status-change',
  name: 'Duty Status Change Notification',
  category: 'Administrative',
  description: 'Notify higher headquarters of Marine\'s change in duty status',
  docType: 'naval_letter',
  ssic: '1320',
  subject: 'DUTY STATUS CHANGE NOTIFICATION',
  paragraphs: [
    { text: 'Notification. Per reference (a), the following duty status change is reported for [RANK FULL NAME], [EDIPI], [MOS].', level: 0 },
    { text: 'Status Change. Previous Status: [PRESENT FOR DUTY/TAD/LEAVE/LIMDU/etc.]. New Status: [NEW STATUS]. Effective Date: [DATE].', level: 0 },
    { text: 'Details. [PROVIDE RELEVANT DETAILS. For LIMDU: diagnosis category, estimated return date, duty limitations. For UA: last known location, circumstances, actions taken. For confinement: location, charges, court-martial date if known.]', level: 0 },
    { text: 'Actions Taken. [DESCRIBE COMMAND ACTIONS - e.g., administrative processing initiated, legal hold placed, notification to next of kin, etc.]', level: 0 },
    { text: 'Point of Contact. Point of contact for this matter is SSgt J. Doe at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1001.59A' },
  ],
};
