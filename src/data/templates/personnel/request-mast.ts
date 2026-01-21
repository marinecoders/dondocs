import type { LetterTemplate } from '../types';

export const requestMast: LetterTemplate = {
  id: 'request-mast',
  name: 'Request Mast',
  category: 'Personnel',
  description: 'Formal request to speak with commanding officer',
  docType: 'naval_letter',
  ssic: '1700',
  subject: 'REQUEST MAST',
  paragraphs: [
    { text: 'Request. Per reference (a), I respectfully request mast with the Commanding Officer.', level: 0 },
    { text: 'Nature of Request. [Clearly state the issue or matter you wish to discuss. Be specific but professional. Include relevant dates and circumstances.]', level: 0 },
    { text: 'Chain of Command Actions. [Describe what actions you have taken to resolve this matter through the chain of command, including dates and outcomes of those discussions.]', level: 0 },
    { text: 'Desired Resolution. [State what outcome or resolution you are seeking from the Commanding Officer.]', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'Article 1150, U.S. Navy Regulations' },
  ],
};
