import type { LetterTemplate } from '../types';

export const recordsDiscrepancy: LetterTemplate = {
  id: 'records-discrepancy',
  name: 'Records Discrepancy Notification',
  category: 'Personnel',
  description: 'Notify a Marine or command of a service-record discrepancy',
  docType: 'naval_letter',
  ssic: '1070',
  subject: 'NOTIFICATION OF RECORDS DISCREPANCY',
  paragraphs: [
    { text: 'Discrepancy. During [AUDIT/REVIEW/RECORDS SCREENING] conducted on [DATE], the following discrepancy was identified in [RANK NAME, EDIPI]’s [OMPF/SERVICE RECORD/MCTFS RECORD]: [DESCRIBE THE DISCREPANCY — what the record shows versus what it should show].', level: 0 },
    { text: 'Supporting Documentation. [Identify the source documents that establish the correct information, e.g., orders, certificates, prior entries. Cite as enclosures where attached.]', level: 0 },
    { text: 'Corrective Action Requested. Request [THE CORRECTION REQUIRED, e.g., correction of the entry, audit of the affected field, submission of the missing document] be completed not later than [DATE] per reference (a).', level: 0 },
    { text: 'Point of Contact. The point of contact for this matter is [RANK NAME] at [PHONE/EMAIL].', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO P1070.12K' },
  ],
};
