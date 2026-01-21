import type { LetterTemplate } from '../types';

export const meritoriousPromo: LetterTemplate = {
  id: 'meritorious-promo',
  name: 'Meritorious Promotion Recommendation',
  category: 'Awards',
  description: 'Recommendation for meritorious promotion',
  docType: 'naval_letter',
  ssic: '1400',
  subject: 'MERITORIOUS PROMOTION RECOMMENDATION',
  paragraphs: [
    { text: 'Recommendation. Per reference (a), [RANK FULL NAME], [MOS], is recommended for meritorious promotion to the grade of [GRADE].', level: 0 },
    { text: 'Background. [Current grade date, TIG, TIS, current billet, and MOS proficiency. Include composite score if applicable.]', level: 0 },
    { text: 'Justification. [Describe exceptional performance that warrants promotion ahead of peers. Use specific examples and quantifiable achievements. Explain why this Marine is more deserving than others awaiting promotion.]', level: 0 },
    { text: 'Leadership. [Describe leadership qualities demonstrated. Include examples of leading Marines, training subordinates, and influencing peers.]', level: 0 },
    { text: 'PME and Self-Improvement. [List completed PME, off-duty education, certifications, and other self-improvement efforts.]', level: 0 },
    { text: 'Physical Fitness. Current PFT score: [SCORE] ([CLASS]). Current CFT score: [SCORE] ([CLASS]). Height/Weight: [COMPLIANT/BCP STATUS].', level: 0 },
    { text: 'Point of Contact. Point of contact is the undersigned at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1001.62A' },
  ],
};
