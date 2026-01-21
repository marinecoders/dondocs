import type { LetterTemplate } from '../types';

export const checkoutLetter: LetterTemplate = {
  id: 'checkout-letter',
  name: 'Checkout/Transfer Letter',
  category: 'Administrative',
  description: 'Letter confirming checkout and transfer requirements',
  docType: 'mfr',
  ssic: '1320',
  subject: 'CHECKOUT INSTRUCTIONS',
  paragraphs: [
    { text: 'Purpose. This memorandum provides checkout instructions in preparation for your transfer to [GAINING UNIT] per orders dated [DATE].', level: 0 },
    { text: 'Checkout Requirements. Complete the attached checkout sheet and obtain all required signatures NLT [DATE]. Ensure all gear is turned in to the armory and supply. Clear all financial obligations with disbursing.', level: 0 },
    { text: 'Records. Report to Admin to verify your service record book is complete and accurate. Ensure all awards, training, and qualifications are properly documented.', level: 0 },
    { text: 'Final Inspection. Report to Building 35, Lincoln Blvd, Presidio of San Francisco on [DATE] at 0800 for final checkout inspection with the First Sergeant.', level: 0 },
    { text: 'Point of Contact. For questions, contact the Admin Chief at (415) 555-1776 / admin.chief@usmc.mil.', level: 0 },
  ],
};
