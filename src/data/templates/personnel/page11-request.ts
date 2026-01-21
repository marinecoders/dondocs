import type { LetterTemplate } from '../types';

export const page11Request: LetterTemplate = {
  id: 'page11-request',
  name: 'Page 11 Entry Request',
  category: 'Personnel',
  description: 'Request for administrative remarks entry in service record',
  docType: 'naval_letter',
  ssic: '1070',
  subject: 'REQUEST FOR PAGE 11 ENTRY',
  paragraphs: [
    { text: 'Request. Per reference (a), request the following administrative remarks entry be made in the official military personnel file of [RANK FULL NAME].', level: 0 },
    { text: 'Proposed Entry. "[DATE]: [VERBATIM TEXT OF PROPOSED PAGE 11 ENTRY. Use proper format per IRAM.]"', level: 0 },
    { text: 'Justification. [Explain why this entry is necessary and appropriate. Reference supporting documentation if applicable.]', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO P1070.12K' },
  ],
};
