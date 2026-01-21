import type { LetterTemplate } from '../types';

export const endorsementApprove: LetterTemplate = {
  id: 'endorsement-approve',
  name: 'Endorsement (Recommend Approval)',
  category: 'Endorsements',
  description: 'Endorsement recommending approval of a request',
  docType: 'same_page_endorsement',
  subject: '',
  paragraphs: [
    { text: '[Provide supporting justification for approval. Include any relevant information not contained in the basic letter that supports the request.]', level: 0 },
  ],
};
