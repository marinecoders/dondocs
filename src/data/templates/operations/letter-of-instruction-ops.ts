import type { LetterTemplate } from '../types';

export const letterOfInstructionOps: LetterTemplate = {
  id: 'letter-of-instruction-ops',
  name: 'Letter of Instruction (Operations)',
  category: 'Operations',
  description: 'Formal instructions for an event or operation',
  docType: 'naval_letter',
  subject: 'LETTER OF INSTRUCTION FOR [EVENT/OPERATION NAME]',
  paragraphs: [
    { text: 'Situation. [DESCRIBE THE EVENT OR REQUIREMENT]', level: 0 },
    { text: 'Mission. [STATE THE MISSION OR OBJECTIVE]', level: 0 },
    { text: 'Execution:', level: 0 },
    { text: 'Commander\'s Intent. [STATE INTENT]', level: 1 },
    { text: 'Concept of Operations. [DESCRIBE HOW THE MISSION WILL BE ACCOMPLISHED]', level: 1 },
    { text: 'Tasks:', level: 1 },
    { text: '[TASK 1 - RESPONSIBLE UNIT/PERSON]', level: 2 },
    { text: '[TASK 2 - RESPONSIBLE UNIT/PERSON]', level: 2 },
    { text: 'Coordinating Instructions:', level: 1 },
    { text: 'Timeline: [KEY DATES/TIMES]', level: 2 },
    { text: 'Uniform: [IF APPLICABLE]', level: 2 },
    { text: 'Admin/Logistics. [DESCRIBE SUPPORT REQUIREMENTS]', level: 0 },
    { text: 'Command/Signal. POC is SSgt J. Doe at j.doe@usmc.mil / (415) 555-1776.', level: 0 },
  ],
};
