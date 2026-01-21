import type { LetterTemplate } from '../types';

export const leaveRequest: LetterTemplate = {
  id: 'leave-request',
  name: 'Leave Request',
  category: 'Personnel',
  description: 'Standard request for annual, emergency, or special leave',
  docType: 'naval_letter',
  ssic: '1050',
  subject: 'REQUEST FOR LEAVE',
  paragraphs: [
    { text: 'Request. Per reference (a), I request annual leave for the period of [START DATE] to [END DATE], for a total of [NUMBER] days of chargeable leave.', level: 0 },
    { text: 'Purpose. [State the purpose of leave - e.g., family vacation, wedding, personal matters, etc.]', level: 0 },
    { text: 'Leave Balance. My current leave balance is [NUMBER] days. Upon completion of this leave, my balance will be [NUMBER] days.', level: 0 },
    { text: 'Contact Information. While on leave, I can be reached at (415) 555-1849. My leave address will be 1 Lincoln Blvd, Presidio of San Francisco, CA 94129.', level: 0 },
    { text: 'Point of Contact. Point of contact for this request is the undersigned at DSN 570-1776 / (415) 555-1776 or j.doe@usmc.mil.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1050.3J' },
  ],
};
