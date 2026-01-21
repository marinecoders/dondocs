import type { LetterTemplate } from '../types';

export const specialLiberty: LetterTemplate = {
  id: 'special-liberty',
  name: 'Special Liberty Request',
  category: 'Personnel',
  description: 'Request for special liberty (72/96 hour)',
  docType: 'naval_letter',
  ssic: '1050',
  subject: 'REQUEST FOR SPECIAL LIBERTY',
  paragraphs: [
    { text: 'Request. Per reference (a), I request [72/96] hour special liberty for the period of [START DATE/TIME] to [END DATE/TIME].', level: 0 },
    { text: 'Purpose. [Provide justification for the special liberty request - e.g., family event, personal matter requiring travel, etc.]', level: 0 },
    { text: 'Travel. I [will/will not] be traveling outside the local liberty area. If traveling: destination is San Francisco, CA, approximately 30 miles from base.', level: 0 },
    { text: 'Contact Information. I can be reached at (415) 555-1906 during the liberty period.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1050.3J' },
  ],
};
