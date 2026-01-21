import type { LetterTemplate } from '../types';

export const appointmentCollateralDuty: LetterTemplate = {
  id: 'appointment-collateral-duty',
  name: 'Appointment to Collateral Duty',
  category: 'Administrative',
  description: 'Appoint a Marine to a collateral duty position',
  docType: 'naval_letter',
  ssic: '5216',
  subject: 'APPOINTMENT TO COLLATERAL DUTY',
  paragraphs: [
    { text: 'Appointment. Effective [DATE], you are hereby appointed as the [DUTY TITLE] for [UNIT NAME].', level: 0 },
    { text: 'Responsibilities. Your responsibilities include but are not limited to: [LIST PRIMARY DUTIES AND RESPONSIBILITIES]. You will serve as the primary point of contact for all matters pertaining to this duty.', level: 0 },
    { text: 'Authority. You are authorized to [LIST SPECIFIC AUTHORITIES GRANTED - e.g., sign for equipment, access spaces, approve requests, etc.]. Exercise this authority in accordance with applicable regulations and command policies.', level: 0 },
    { text: 'Training. Ensure completion of all required training for this duty within [NUMBER] days of this appointment. Coordinate with [PERSON/OFFICE] for scheduling and certification.', level: 0 },
    { text: 'Turnover. Maintain complete and accurate records. Upon relief, conduct a thorough turnover with your replacement and provide a turnover folder containing all relevant documents, SOPs, and points of contact.', level: 0 },
    { text: 'Duration. This appointment remains in effect until relieved in writing or upon your departure from this command.', level: 0 },
  ],
};
