import type { LetterTemplate } from '../types';

export const endorsementInfo: LetterTemplate = {
  id: 'endorsement-info',
  name: 'Endorsement (For Information)',
  category: 'Endorsements',
  description: 'Endorsement forwarding without recommendation',
  docType: 'new_page_endorsement',
  subject: '',
  paragraphs: [
    { text: '[Provide any additional information or context relevant to the basic letter. State if no additional comments or recommendations are required at this level.]', level: 0 },
  ],
};
