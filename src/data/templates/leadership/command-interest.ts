import type { LetterTemplate } from '../types';

export const commandInterest: LetterTemplate = {
  id: 'command-interest',
  name: 'Command Interest Letter',
  category: 'Leadership',
  description: 'Letter expressing command interest in a Marine\'s development',
  docType: 'naval_letter',
  ssic: '1610',
  subject: 'COMMAND INTEREST',
  paragraphs: [
    { text: 'Purpose. This letter establishes command interest in [RANK FULL NAME] to ensure proper mentorship and career development.', level: 0 },
    { text: 'Background. [Explain why command interest is being established: performance concerns, development potential, recent personal difficulties, or other relevant circumstances.]', level: 0 },
    { text: 'Expectations. [Outline specific expectations for the Marine during the command interest period. Include performance standards, behavior requirements, or development goals.]', level: 0 },
    { text: 'Mentorship. [MENTOR\'S RANK AND NAME] is assigned as mentor and will provide weekly counseling and guidance. Mentor will report progress to the First Sergeant monthly.', level: 0 },
    { text: 'Duration. This command interest will remain in effect for [PERIOD] or until removed by the Commanding Officer, whichever occurs first.', level: 0 },
  ],
};
