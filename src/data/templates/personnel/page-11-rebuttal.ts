import type { LetterTemplate } from '../types';

// IRAM 4006.2e sends the statement to the commander, and 4006.3r(a)
// specifies plain white paper and pertinent facts. Use the existing
// plain-paper standard letter layout for the written response.
export const page11Rebuttal: LetterTemplate = {
  id: 'page-11-rebuttal',
  name: 'Page 11 Rebuttal',
  category: 'Personnel',
  description: 'Write a response to an adverse NAVMC 118(11) entry for your commanding officer. Identify the entry by date and address the pertinent facts.',
  docType: 'standard_letter',
  subject: 'REBUTTAL TO ADVERSE PAGE 11 ENTRY',
  useProfileDefaults: false,
  correspondenceDefaults: {
    from: '[Rank and full name, USMC]',
    to: '[Commanding Officer, unit]',
    pageNumbering: 'simple',
  },
  paragraphs: [
    { text: '[Identify the dated entry and explain the pertinent facts and any corrections you request.]', level: 0 },
  ],
};
