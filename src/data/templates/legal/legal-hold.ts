import type { LetterTemplate } from '../types';

export const legalHold: LetterTemplate = {
  id: 'legal-hold',
  name: 'Legal Hold Notification',
  category: 'Legal',
  description: 'Notification of litigation hold on documents/evidence',
  docType: 'mfr',
  ssic: '5800',
  subject: 'LITIGATION HOLD NOTICE',
  paragraphs: [
    { text: 'Notice. This memorandum serves as official notice of a litigation hold effective immediately. You are required to preserve all documents, records, and electronically stored information (ESI) related to [SUBJECT MATTER/CASE NAME].', level: 0 },
    { text: 'Scope. This hold applies to all documents and information, regardless of format, related to [DESCRIBE SCOPE: specific incident, time period, individuals, or subject matter]. This includes but is not limited to emails, text messages, photographs, videos, reports, notes, and any other records.', level: 0 },
    { text: 'Preservation Requirements. You must immediately: (1) Suspend any routine destruction of relevant documents; (2) Preserve all relevant electronic communications including emails, texts, and voicemails; (3) Preserve all relevant physical documents; (4) Preserve any relevant evidence in your possession or control.', level: 0 },
    { text: 'Prohibition. Do NOT delete, destroy, alter, or dispose of any potentially relevant documents or information. Failure to comply with this hold may result in adverse legal consequences and potential disciplinary action.', level: 0 },
    { text: 'Duration. This litigation hold will remain in effect until you receive written notice of its release. Do not assume the hold has been lifted unless you receive official notification.', level: 0 },
    { text: 'Questions. Direct any questions regarding this hold to the Staff Judge Advocate at (415) 555-1849 / sja@usmc.mil.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'JAGMAN' },
  ],
};
