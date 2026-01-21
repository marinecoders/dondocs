import type { LetterTemplate } from '../types';

export const appointmentInvestigatingOfficer: LetterTemplate = {
  id: 'appointment-investigating-officer',
  name: 'Appointment as Investigating Officer',
  category: 'Investigations',
  description: 'Appoint an officer or SNCO to conduct a command investigation',
  docType: 'naval_letter',
  ssic: '5830',
  subject: 'APPOINTMENT AS INVESTIGATING OFFICER',
  paragraphs: [
    { text: 'Appointment. Per references (a) and (b), you are hereby appointed as Investigating Officer (IO) to conduct a command investigation into [BRIEF DESCRIPTION OF INCIDENT/MATTER].', level: 0 },
    { text: 'Scope. You are directed to investigate the facts and circumstances surrounding [DETAILED DESCRIPTION]. This investigation should determine [LIST SPECIFIC QUESTIONS TO BE ANSWERED].', level: 0 },
    { text: 'Authority. You are authorized to interview all personnel who may have relevant information, examine all pertinent documents and physical evidence, and take sworn statements as necessary. All members of this command are directed to cooperate fully with this investigation.', level: 0 },
    { text: 'Timeline. Submit your findings of fact, opinions, and recommendations to the undersigned no later than [DATE], unless an extension is requested and approved.', level: 0 },
    { text: 'Report Format. Your report should include: (1) preliminary statement identifying the appointment authority and scope; (2) findings of fact; (3) opinions; (4) recommendations; and (5) all enclosures including witness statements and documentary evidence.', level: 0 },
    { text: 'Legal Review. Upon completion, your investigation will be forwarded to the Staff Judge Advocate for legal sufficiency review prior to final action.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'JAGMAN Chapter II' },
    { letter: 'b', title: 'MCO 5830.8A' },
  ],
};
