import type { LetterTemplate } from '../types';

export const sgliUpdate: LetterTemplate = {
  id: 'sgli-update',
  name: 'SGLI Beneficiary Update',
  category: 'Administrative',
  description: 'Notification of SGLI beneficiary change',
  docType: 'naval_letter',
  ssic: '1750',
  subject: 'SERVICEMEMBERS\' GROUP LIFE INSURANCE (SGLI) BENEFICIARY UPDATE',
  paragraphs: [
    { text: 'Purpose. Per reference (a), this letter confirms my election to update my SGLI beneficiary designation.', level: 0 },
    { text: 'Coverage. I currently maintain SGLI coverage in the amount of [AMOUNT]. I have elected to [maintain/increase/decrease] my coverage to [AMOUNT].', level: 0 },
    { text: 'Beneficiary Designation. Enclosure (1) is my updated SGLV 8286 designating my beneficiaries as indicated therein.', level: 0 },
    { text: 'Acknowledgment. I understand this designation supersedes all previous beneficiary designations and will remain in effect until modified or revoked by me in writing.', level: 0 },
  ],
  references: [
    { letter: 'a', title: '38 U.S.C. Chapter 19' },
  ],
};
