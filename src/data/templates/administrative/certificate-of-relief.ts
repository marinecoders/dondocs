import type { LetterTemplate } from '../types';

export const certificateOfRelief: LetterTemplate = {
  id: 'certificate-of-relief',
  name: 'Certificate of Relief',
  category: 'Administrative',
  description: 'Certify relief of a duty, post, or accountable responsibility',
  docType: 'naval_letter',
  ssic: '1601',
  subject: 'CERTIFICATE OF RELIEF',
  paragraphs: [
    { text: 'Relief. I certify that on [DATE] at [TIME], I was properly relieved of my duties as [BILLET/POST, e.g., Command Duty Officer, Supply Officer] by [RANK NAME].', level: 0 },
    { text: 'Turnover. All [LOGS/EQUIPMENT/FUNDS/PROPERTY/CLASSIFIED MATERIAL] for which I was responsible have been jointly inventoried and transferred to my relief. [Cite the turnover documents or inventories as enclosures where applicable.]', level: 0 },
    { text: 'Exceptions. [List any discrepancies, shortages, or open items noted at turnover and the corrective action in progress. If there are none, state: There are no exceptions to this relief.]', level: 0 },
    { text: 'Acknowledgment of Relief. [RANK NAME OF RELIEVING INDIVIDUAL] assumes the duties of [BILLET/POST] effective the date and time above per [UNIT SOP/GOVERNING ORDER].', level: 0 },
  ],
};
