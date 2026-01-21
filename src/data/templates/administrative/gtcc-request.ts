import type { LetterTemplate } from '../types';

export const gtccRequest: LetterTemplate = {
  id: 'gtcc-request',
  name: 'Government Travel Card Request',
  category: 'Administrative',
  description: 'Request for Government Travel Charge Card',
  docType: 'mfr',
  ssic: '4600',
  subject: 'REQUEST FOR GOVERNMENT TRAVEL CHARGE CARD',
  paragraphs: [
    { text: 'Request. Per reference (a), I request issuance of a Government Travel Charge Card (GTCC) for official travel purposes.', level: 0 },
    { text: 'Justification. A GTCC is required to support upcoming TAD orders to the Presidio of San Francisco, CA scheduled for [DATE]. My duties require frequent official travel that necessitates a GTCC.', level: 0 },
    { text: 'Acknowledgment. I acknowledge that I have completed the required GTCC training and understand my responsibilities as a cardholder per reference (a).', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'DoD 7000.14-R, Vol. 9' },
  ],
};
