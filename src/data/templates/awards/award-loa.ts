import type { LetterTemplate } from '../types';

export const awardLoa: LetterTemplate = {
  id: 'award-loa',
  name: 'Letter of Appreciation',
  category: 'Awards',
  description: 'Formal letter of appreciation for outstanding service',
  docType: 'naval_letter',
  ssic: '1650',
  subject: 'LETTER OF APPRECIATION',
  paragraphs: [
    { text: 'I would like to express my sincere appreciation for your outstanding performance and dedication to duty while serving as [BILLET] from [START DATE] to [END DATE].', level: 0 },
    { text: '[Describe specific accomplishments, highlighting 2-3 key achievements and their positive impact on the unit or mission.]', level: 0 },
    { text: 'Your professionalism, initiative, and commitment to excellence reflect great credit upon yourself and [UNIT NAME]. I wish you continued success and Semper Fidelis.', level: 0 },
  ],
};
