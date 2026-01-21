import type { LetterTemplate } from '../types';

export const pftWaiver: LetterTemplate = {
  id: 'pft-waiver',
  name: 'PFT/CFT Waiver Request',
  category: 'Personnel',
  description: 'Request for waiver of physical fitness test',
  docType: 'naval_letter',
  ssic: '6100',
  subject: 'REQUEST FOR PFT/CFT WAIVER',
  paragraphs: [
    { text: 'Request. Per reference (a), I request a waiver from the [PFT/CFT] scheduled for [DATE] due to [MEDICAL/ADMINISTRATIVE] reasons.', level: 0 },
    { text: 'Justification. [Explain the circumstances requiring the waiver. If medical, reference medical documentation. If administrative, explain the situation.]', level: 0 },
    { text: 'Alternative Date. I request to complete the [PFT/CFT] on or about [PROPOSED DATE] when [explain when condition will be resolved or situation permits].', level: 0 },
    { text: 'Supporting Documentation. Enclosure (1) provides [medical documentation/supporting documentation] for this request.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 6100.13A' },
  ],
};
