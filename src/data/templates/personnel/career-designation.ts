import type { LetterTemplate } from '../types';

export const careerDesignation: LetterTemplate = {
  id: 'career-designation',
  name: 'Career Designation Package Cover',
  category: 'Personnel',
  description: 'Cover letter for career designation request',
  docType: 'naval_letter',
  ssic: '1040',
  subject: 'CAREER DESIGNATION REQUEST',
  paragraphs: [
    { text: 'Request. Per reference (a), I request career designation as an indication of my commitment to continued service in the United States Marine Corps.', level: 0 },
    { text: 'Service Record. I entered active duty on [DATE]. I am currently serving in the grade of [RANK] with an EAS of [DATE]. My primary MOS is [MOS/TITLE].', level: 0 },
    { text: 'Career Intentions. [State your career intentions and reasons for requesting career designation. Demonstrate your commitment to the Marine Corps and your plans for continued professional development.]', level: 0 },
    { text: 'Qualifications. Current PFT: [SCORE]. Current CFT: [SCORE]. Rifle qualification: [QUAL/DATE]. [List any additional qualifications, certifications, or achievements relevant to career designation.]', level: 0 },
    { text: 'Recommendation. I respectfully request favorable consideration of this career designation package.', level: 0 },
    { text: 'Point of Contact. Point of contact is the undersigned at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1040.31' },
  ],
};
