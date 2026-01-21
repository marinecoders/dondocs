import type { LetterTemplate } from '../types';

export const appointmentSafetyOfficer: LetterTemplate = {
  id: 'appointment-safety-officer',
  name: 'Appointment as Safety Officer',
  category: 'Administrative',
  description: 'Appoint a unit Safety Officer',
  docType: 'naval_letter',
  ssic: '5100',
  subject: 'APPOINTMENT AS UNIT SAFETY OFFICER',
  paragraphs: [
    { text: 'Appointment. Effective [DATE], you are hereby appointed as the Unit Safety Officer for [UNIT NAME].', level: 0 },
    { text: 'Responsibilities. Your responsibilities include: (1) implementing and managing the unit safety program per reference (a); (2) conducting safety inspections and risk assessments; (3) investigating mishaps and near-misses; (4) conducting safety training and awareness campaigns; (5) maintaining required safety documentation and reports.', level: 0 },
    { text: 'Authority. You are authorized to: halt any operation presenting imminent danger; access all spaces and operations for safety inspections; direct immediate corrective actions for safety hazards; and report directly to the Commanding Officer on safety matters.', level: 0 },
    { text: 'Training Requirements. Complete the following training within 90 days: (1) [SERVICE] Safety Officer Course; (2) Operational Risk Management (ORM) Course; (3) Mishap Investigation Course. Document all certifications and maintain currency.', level: 0 },
    { text: 'Coordination. Coordinate with higher headquarters safety personnel and participate in all safety working groups and inspections as required.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 5100.29B' },
  ],
};
