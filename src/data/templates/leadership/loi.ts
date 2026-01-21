import type { LetterTemplate } from '../types';

export const loi: LetterTemplate = {
  id: 'loi',
  name: 'Letter of Instruction',
  category: 'Leadership',
  description: 'Formal letter providing specific instructions or guidance',
  docType: 'mfr',
  ssic: '5000',
  subject: 'LETTER OF INSTRUCTION',
  paragraphs: [
    { text: 'Purpose. This letter provides instructions and guidance for [EVENT/TASK/OPERATION/PROGRAM].', level: 0 },
    { text: 'Background. [Provide context and background information necessary to understand the requirement.]', level: 0 },
    { text: 'Scope. [Define what is covered by these instructions, including applicable personnel, timeframes, and geographic areas.]', level: 0 },
    { text: 'Instructions. [Provide detailed, numbered instructions. Be specific about who, what, when, where, and how. Include specific tasks, responsibilities, and deadlines.]', level: 0 },
    { text: 'Coordination. [Identify coordination requirements, reporting chains, and key personnel involved.]', level: 0 },
    { text: 'Resources. [Identify resources available, funding sources, equipment, or personnel support.]', level: 0 },
    { text: 'Point of Contact. Point of contact for this matter is SSgt J. Doe at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
  ],
};
