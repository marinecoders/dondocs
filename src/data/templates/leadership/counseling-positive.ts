import type { LetterTemplate } from '../types';

export const counselingPositive: LetterTemplate = {
  id: 'counseling-positive',
  name: 'Counseling (Positive)',
  category: 'Leadership',
  description: 'Documented positive counseling for outstanding performance',
  docType: 'mfr',
  ssic: '1610',
  subject: 'POSITIVE COUNSELING',
  paragraphs: [
    { text: 'Purpose. To formally recognize and document your outstanding performance and positive contributions to the unit.', level: 0 },
    { text: 'Observation. [Describe the specific positive behavior, accomplishment, or performance observed. Include date(s) and circumstances.]', level: 0 },
    { text: 'Impact. [Explain the positive impact this had on the unit, mission accomplishment, or fellow Marines.]', level: 0 },
    { text: 'Recommendation. Continue to maintain this high standard of performance. Your dedication and professionalism set the example for others to follow.', level: 0 },
  ],
};
