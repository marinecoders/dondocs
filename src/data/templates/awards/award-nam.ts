import type { LetterTemplate } from '../types';

export const awardNam: LetterTemplate = {
  id: 'award-nam',
  name: 'Award Recommendation (NAM)',
  category: 'Awards',
  description: 'Navy and Marine Corps Achievement Medal recommendation',
  docType: 'naval_letter',
  ssic: '1650',
  subject: 'RECOMMENDATION FOR NAVY AND MARINE CORPS ACHIEVEMENT MEDAL',
  paragraphs: [
    { text: 'Recommendation. Per references (a) and (b), [RANK FULL NAME] is recommended for the Navy and Marine Corps Achievement Medal for meritorious [service/achievement] while serving as [BILLET TITLE], [UNIT NAME], from [START DATE] to [END DATE].', level: 0 },
    { text: 'Background. [Provide context about the Marine\'s duties and responsibilities during the award period.]', level: 0 },
    { text: 'Justification. [Describe specific achievements that warrant recognition. Use quantifiable metrics where possible. Focus on actions that exceeded normal expectations. Examples: led X Marines, trained X personnel, saved X dollars, improved readiness by X percent, etc.]', level: 0 },
    { text: 'Impact. [Explain the positive impact these achievements had on unit readiness, mission accomplishment, or Marine Corps operations.]', level: 0 },
    { text: 'Point of Contact. Point of contact for this matter is the undersigned at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'SECNAVINST 1650.1H' },
    { letter: 'b', title: 'MCO 1650.19J' },
  ],
};
