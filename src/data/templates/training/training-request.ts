import type { LetterTemplate } from '../types';

export const trainingRequest: LetterTemplate = {
  id: 'training-request',
  name: 'Training Request',
  category: 'Training',
  description: 'Request for formal school or training course',
  docType: 'naval_letter',
  ssic: '1500',
  subject: 'REQUEST FOR TRAINING',
  paragraphs: [
    { text: 'Request. Per reference (a), I request authorization to attend [COURSE NAME] ([COURSE NUMBER if applicable]) conducted at the Presidio of San Francisco, CA from [START DATE] to [END DATE].', level: 0 },
    { text: 'Justification. [Explain how this training supports your current billet, MOS requirements, or career development. Describe how the unit will benefit from this training.]', level: 0 },
    { text: 'Funding. [Address funding requirements: TDY costs, course fees, etc. Identify source of funding if known.]', level: 0 },
    { text: 'Impact. My absence during this training period [will/will not] impact unit operations. [If applicable: explain how duties will be covered.]', level: 0 },
    { text: 'Point of Contact. Point of contact for this request is the undersigned at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1500.52' },
  ],
};
