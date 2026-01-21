import type { LetterTemplate } from '../types';

export const mfrMeeting: LetterTemplate = {
  id: 'mfr-meeting',
  name: 'MFR - Meeting Notes',
  category: 'Memoranda',
  description: 'Record of meeting or discussion',
  docType: 'mfr',
  subject: 'RECORD OF MEETING: [TOPIC]',
  paragraphs: [
    { text: 'Purpose. This memorandum records the discussion held on [DATE] regarding [TOPIC].', level: 0 },
    { text: 'Attendees:', level: 0 },
    { text: '[RANK/NAME, TITLE]', level: 1 },
    { text: '[RANK/NAME, TITLE]', level: 1 },
    { text: 'Discussion. [SUMMARIZE KEY POINTS DISCUSSED]', level: 0 },
    { text: 'Decisions. The following decisions were made:', level: 0 },
    { text: '[DECISION 1]', level: 1 },
    { text: '[DECISION 2]', level: 1 },
    { text: 'Action Items:', level: 0 },
    { text: '[ACTION] - [RESPONSIBLE PARTY] - [DUE DATE]', level: 1 },
  ],
};
