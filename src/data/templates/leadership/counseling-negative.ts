import type { LetterTemplate } from '../types';

export const counselingNegative: LetterTemplate = {
  id: 'counseling-negative',
  name: 'Counseling (Corrective)',
  category: 'Leadership',
  description: 'Documented corrective counseling for deficiencies',
  docType: 'mfr',
  ssic: '1610',
  subject: 'CORRECTIVE COUNSELING',
  paragraphs: [
    { text: 'Purpose. To formally document a deficiency in your performance/conduct and establish clear expectations for immediate improvement.', level: 0 },
    { text: 'Observation. [Describe the specific deficiency observed. Include date, time, location, and circumstances. Be factual and specific.]', level: 0 },
    { text: 'Standard. [Cite the applicable standard, order, regulation, or policy that was not met. Reference specific MCO, unit SOP, or UCMJ article if applicable.]', level: 0 },
    { text: 'Impact. [Explain how this deficiency negatively affected or could affect unit readiness, good order and discipline, or mission accomplishment.]', level: 0 },
    { text: 'Expectation. You are expected to correct this deficiency immediately and ensure it does not recur. Failure to improve may result in adverse administrative or disciplinary action.', level: 0 },
    { text: 'Assistance. [Identify any assistance, resources, or training available to help the Marine improve. Include mentor assignment if applicable.]', level: 0 },
    { text: 'Acknowledgment. Your signature below acknowledges receipt of this counseling. It does not indicate agreement or disagreement with its contents.', level: 0 },
  ],
};
