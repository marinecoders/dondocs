import type { LetterTemplate } from '../types';

export const personalAwardRecommendation: LetterTemplate = {
  id: 'personal-award-recommendation',
  name: 'Personal Award Recommendation',
  category: 'Awards',
  description: 'Recommend a Marine for a personal decoration (general format)',
  docType: 'naval_letter',
  ssic: '1650',
  subject: 'PERSONAL AWARD RECOMMENDATION FOR [RANK NAME]',
  paragraphs: [
    { text: 'Recommendation. Per reference (a), [RANK FULL NAME, USMC] is recommended for the [AWARD NAME] for [his/her] [meritorious service/heroic achievement/meritorious achievement] while serving as [BILLET] from [START DATE] to [END DATE].', level: 0 },
    { text: 'Summary of Action. [PROVIDE NARRATIVE DESCRIPTION. For meritorious service: describe sustained superior performance, specific accomplishments, and impact. For achievement: describe the specific act or event, circumstances, and outcome. Be specific with facts and figures.]', level: 0 },
    { text: 'Impact. [DESCRIBE IMPACT. How did the Marine\'s actions contribute to mission accomplishment? What was the scope of responsibility? Who benefited from their efforts?]', level: 0 },
    { text: 'Justification. [EXPLAIN WHY THIS AWARD IS APPROPRIATE. Compare to award criteria in reference (a). Why does performance warrant recognition at this level versus a lower award?]', level: 0 },
    { text: 'Recommendation. [RANK NAME]\'s [service/actions] reflect great credit upon [himself/herself] and are in keeping with the highest traditions of the United States Marine Corps. I strongly recommend approval of this award.', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'SECNAVINST 1650.1H' },
  ],
};
