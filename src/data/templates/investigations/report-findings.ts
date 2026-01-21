import type { LetterTemplate } from '../types';

export const reportFindings: LetterTemplate = {
  id: 'report-findings',
  name: 'Report of Findings',
  category: 'Investigations',
  description: 'Formal report documenting investigation findings',
  docType: 'naval_letter',
  ssic: '5830',
  subject: 'REPORT OF PRELIMINARY INQUIRY',
  paragraphs: [
    { text: 'Authority. Per reference (a), a preliminary inquiry was conducted into [SUBJECT MATTER] as directed by [CONVENING AUTHORITY] on [DATE].', level: 0 },
    { text: 'Background. [Provide background information and circumstances that prompted the inquiry. Include dates, locations, and personnel involved.]', level: 0 },
    { text: 'Methodology. [Describe how the inquiry was conducted: witnesses interviewed, documents reviewed, evidence examined, etc.]', level: 0 },
    { text: 'Findings of Fact. [List specific findings based on evidence gathered. Use numbered sub-paragraphs for clarity. Be objective and factual.]', level: 0 },
    { text: 'Conclusion. [State conclusions drawn from the findings. Address whether allegations were substantiated or unsubstantiated.]', level: 0 },
    { text: 'Recommendation. [Provide recommendations for action: further investigation, administrative action, disciplinary action, case closure, or other appropriate disposition.]', level: 0 },
  ],
  references: [
    { letter: 'a', title: '[Convening authority directive or appointing order]' },
  ],
};
