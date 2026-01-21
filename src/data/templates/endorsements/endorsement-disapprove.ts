import type { LetterTemplate } from '../types';

export const endorsementDisapprove: LetterTemplate = {
  id: 'endorsement-disapprove',
  name: 'Endorsement (Recommend Disapproval)',
  category: 'Endorsements',
  description: 'Endorsement recommending disapproval of a request',
  docType: 'same_page_endorsement',
  subject: '',
  paragraphs: [
    { text: '[Provide specific reasons for recommending disapproval. Be factual and professional. Reference applicable policies or regulations if relevant.]', level: 0 },
  ],
};
