import type { LetterTemplate } from '../types';

export const notarizedStatement: LetterTemplate = {
  id: 'notarized-statement',
  name: 'Statement Under Oath',
  category: 'Legal',
  description: 'Format for sworn statement in investigations',
  docType: 'mfr',
  ssic: '5830',
  subject: 'SWORN STATEMENT',
  paragraphs: [
    { text: 'I, [FULL NAME], [RANK/RATE if applicable], having been duly sworn, do hereby state the following:', level: 0 },
    { text: '[PROVIDE DETAILED STATEMENT OF FACTS. Include: who was involved, what happened, when it occurred, where it took place, and any other relevant details. Be specific and factual. Avoid opinions unless specifically requested.]', level: 0 },
    { text: '[CONTINUE STATEMENT AS NEEDED. Use separate paragraphs for different events or topics. Include any physical evidence observed, documents reviewed, or statements heard from others (attribute properly).]', level: 0 },
    { text: 'I have read this statement consisting of [NUMBER] pages. I fully understand its contents. This statement is true and correct to the best of my knowledge and belief.', level: 0 },
  ],
};
