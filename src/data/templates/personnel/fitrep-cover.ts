import type { LetterTemplate } from '../types';

export const fitrepCover: LetterTemplate = {
  id: 'fitrep-cover',
  name: 'Fitness Report Cover Letter',
  category: 'Personnel',
  description: 'Cover letter for fitness report submission',
  docType: 'naval_letter',
  ssic: '1610',
  subject: 'FITNESS REPORT',
  paragraphs: [
    { text: 'Enclosure (1) is submitted for [RANK FULL NAME] for the reporting period [START DATE] to [END DATE]. This is a [REGULAR/TRANSFER/DETACHMENT/SPECIAL] fitness report.', level: 0 },
    { text: '[If applicable: Provide any amplifying information regarding the report, such as explanation of adverse marks, comments on Marine\'s potential, or other relevant context.]', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1610.7A' },
  ],
};
