import type { LetterTemplate } from '../types';

export const entry6105: LetterTemplate = {
  id: '6105-entry',
  name: '6105 Counseling Entry Request',
  category: 'Leadership',
  description: 'Request for adverse page 11 entry (6105)',
  docType: 'naval_letter',
  ssic: '1610',
  subject: 'REQUEST FOR ADMINISTRATIVE REMARKS (6105) ENTRY',
  paragraphs: [
    { text: 'Request. Per references (a) and (b), request the following 6105 counseling entry be made in the service record of [RANK FULL NAME].', level: 0 },
    { text: 'Incident. [Describe the specific incident, deficiency, or pattern of behavior that warrants this entry. Include dates, locations, and factual description of events.]', level: 0 },
    { text: 'Standard Violated. [Cite the specific order, regulation, policy, or standard that was violated. Reference UCMJ articles if applicable.]', level: 0 },
    { text: 'Prior Counseling. [Document prior counseling efforts, including dates and outcomes. Reference any previous page 11 entries or documented counseling sessions.]', level: 0 },
    { text: 'Proposed Entry. "[DATE]: Per MCO 1610.7A, you are being formally counseled for [BRIEF DESCRIPTION]. [DETAILED NARRATIVE]. Failure to correct this deficiency may result in further adverse administrative or disciplinary action, to include [POTENTIAL CONSEQUENCES]."', level: 0 },
    { text: 'Marine\'s Rights. Per reference (a), the Marine has been advised of the right to submit a written statement within 10 working days. The statement will be filed with this entry.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1610.7A' },
    { letter: 'b', title: 'MCO 1070.12K' },
  ],
};
