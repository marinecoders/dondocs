import type { LetterTemplate } from '../types';

export const extensionEndorsement: LetterTemplate = {
  id: 'extension-endorsement',
  name: 'Extension of Enlistment Endorsement',
  category: 'Endorsements',
  description: 'Command endorsement for reenlistment or extension request',
  docType: 'new_page_endorsement',
  ssic: '1040',
  subject: '',
  paragraphs: [
    { text: 'Recommendation. [RECOMMEND APPROVAL/DISAPPROVAL] of [RANK NAME]\'s request for [extension/reenlistment].', level: 0 },
    { text: 'Performance. [RANK NAME] has served at this command since [DATE]. [His/Her] performance has been [DESCRIPTION]. Current proficiency/conduct marks: [PRO/CON]. Most recent FITREP marking average: [AVERAGE].', level: 0 },
    { text: 'Qualifications. Physical fitness: PFT [SCORE/CLASS], CFT [SCORE/CLASS]. Rifle qualification: [QUAL/DATE]. [Any disqualifying factors or waivers required: N/A or specify].', level: 0 },
    { text: 'Conduct. [Address any adverse information: NJPs, courts-martial, civilian convictions, debt issues, etc. If none: "No adverse information is on file."]', level: 0 },
    { text: 'Endorsement. [If recommending approval: This Marine is a valuable asset and continued service is in the best interest of the Marine Corps. If disapproving: Provide specific reasons per applicable directives.]', level: 0 },
  ],
  references: [
    { letter: 'a', title: 'MCO 1040.31' },
  ],
};
