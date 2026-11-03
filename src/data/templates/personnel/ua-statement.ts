import type { LetterTemplate } from '../types';

export const uaStatement: LetterTemplate = {
  id: 'ua-statement',
  name: 'Unauthorized Absence Statement',
  category: 'Personnel',
  description: 'Statement documenting the circumstances of an unauthorized absence',
  docType: 'naval_letter',
  ssic: '1050',
  subject: 'STATEMENT REGARDING UNAUTHORIZED ABSENCE',
  paragraphs: [
    { text: 'Period of Absence. I was absent from [UNIT/PLACE OF DUTY] without authority from [TIME] on [DATE] until [TIME] on [DATE], when I [RETURNED TO/SURRENDERED AT/WAS APPREHENDED AT] [LOCATION].', level: 0 },
    { text: 'Circumstances. [Describe in the Marine’s own words the circumstances of the absence — what led to it, where the Marine was, and any events relevant to its beginning and end.]', level: 0 },
    { text: 'Mitigating Factors. [Describe any circumstances offered in mitigation, e.g., family emergency, medical situation, transportation failure. Attach supporting documentation as enclosures where available. Omit if none.]', level: 0 },
    { text: 'Acknowledgment. I make this statement freely and voluntarily. I understand this statement documents the period of absence in my service record per reference (a) and may be considered in any administrative or disciplinary action arising from the absence.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO P1070.12K' },
  ],
};
