import type { LetterTemplate } from '../types';

/**
 * The appointee's half of an appointment: a first endorsement back to the
 * appointing officer acknowledging the duty.
 *
 * Wording follows the acknowledgement endorsements published with real
 * appointment letters (e.g. MCCS Hawaii's SMP representative letter and
 * enclosure (2) to MCAS Miramar StaO 1710.4B) — read-and-understand the
 * references, then assume the duties. The duty title and references are left
 * as placeholders: the appointment letter is the same shape whatever the
 * collateral duty is, and only the governing references change with it.
 */
export const appointmentAcknowledgement: LetterTemplate = {
  id: 'appointment-acknowledgement',
  name: 'Appointment Acknowledgement (Endorsement)',
  category: 'Administrative',
  description: "Acknowledge an appointment back to the appointing officer — the appointee's endorsement",
  docType: 'same_page_endorsement',
  subject: 'APPOINTMENT TO COLLATERAL DUTY',
  paragraphs: [
    { text: 'I have read and understand the references listed above and all orders pertaining to my appointment.', level: 0 },
    { text: 'I hereby assume the duties and responsibilities as the [DUTY TITLE] for [UNIT NAME].', level: 0 },
  ],
};
