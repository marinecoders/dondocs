import type { LetterTemplate } from '../types';

export const meritoriousMast: LetterTemplate = {
  id: 'meritorious-mast',
  name: 'Meritorious Mast Recommendation',
  category: 'Awards',
  description: 'Recommend a Marine for Meritorious Mast recognition',
  docType: 'naval_letter',
  ssic: '1650',
  subject: 'MERITORIOUS MAST RECOMMENDATION FOR [RANK NAME]',
  paragraphs: [
    { text: 'Recommendation. [RANK FULL NAME, USMC], is recommended for Meritorious Mast in recognition of [his/her] superior performance of duty while serving as [BILLET] from [START DATE] to [END DATE].', level: 0 },
    { text: 'Accomplishments. [DESCRIBE SPECIFIC ACCOMPLISHMENTS. Be specific with facts, figures, and impacts. What did the Marine do that went above and beyond normal expectations? How did their actions benefit the command, mission, or fellow Marines?]', level: 0 },
    { text: 'Impact. [DESCRIBE THE IMPACT. Quantify results where possible. How did their performance contribute to mission accomplishment? What would have happened without their efforts?]', level: 0 },
    { text: 'Character. [RANK NAME]\'s dedication, professionalism, and initiative reflect great credit upon [himself/herself] and are in keeping with the highest traditions of the United States Marine Corps.', level: 0 },
    { text: 'Recommendation. I strongly recommend [RANK NAME] be recognized via Meritorious Mast for [his/her] outstanding contributions to this command.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1650.19J' },
  ],
};
