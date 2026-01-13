import { useState, useMemo } from 'react';
import { FileText, FolderOpen, Search, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';

interface TemplateParagraph {
  text: string;
  level: number;
}

interface TemplateReference {
  letter: string;
  title: string;
  url?: string;
}

interface LetterTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  docType: string;
  subject: string;
  paragraphs: TemplateParagraph[];
  references?: TemplateReference[];
  ssic?: string;
}

// Pre-built letter templates for common correspondence
const LETTER_TEMPLATES: LetterTemplate[] = [
  // === PERSONNEL ===
  {
    id: 'leave-request',
    name: 'Leave Request',
    category: 'Personnel',
    description: 'Standard request for annual, emergency, or special leave',
    docType: 'naval_letter',
    ssic: '1050',
    subject: 'REQUEST FOR LEAVE',
    paragraphs: [
      { text: 'Request. Per reference (a), I request annual leave for the period of [START DATE] to [END DATE], for a total of [NUMBER] days of chargeable leave.', level: 0 },
      { text: 'Purpose. [State the purpose of leave - e.g., family vacation, wedding, personal matters, etc.]', level: 0 },
      { text: 'Leave Balance. My current leave balance is [NUMBER] days. Upon completion of this leave, my balance will be [NUMBER] days.', level: 0 },
      { text: 'Contact Information. While on leave, I can be reached at (415) 555-1849. My leave address will be 1 Lincoln Blvd, Presidio of San Francisco, CA 94129.', level: 0 },
      { text: 'Point of Contact. Point of contact for this request is the undersigned at DSN 570-1776 / (415) 555-1776 or j.doe@usmc.mil.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO 1050.3J' },
    ],
  },
  {
    id: 'special-liberty',
    name: 'Special Liberty Request',
    category: 'Personnel',
    description: 'Request for special liberty (72/96 hour)',
    docType: 'naval_letter',
    ssic: '1050',
    subject: 'REQUEST FOR SPECIAL LIBERTY',
    paragraphs: [
      { text: 'Request. Per reference (a), I request [72/96] hour special liberty for the period of [START DATE/TIME] to [END DATE/TIME].', level: 0 },
      { text: 'Purpose. [Provide justification for the special liberty request - e.g., family event, personal matter requiring travel, etc.]', level: 0 },
      { text: 'Travel. I [will/will not] be traveling outside the local liberty area. If traveling: destination is San Francisco, CA, approximately 30 miles from base.', level: 0 },
      { text: 'Contact Information. I can be reached at (415) 555-1906 during the liberty period.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO 1050.3J' },
    ],
  },
  {
    id: 'request-mast',
    name: 'Request Mast',
    category: 'Personnel',
    description: 'Formal request to speak with commanding officer',
    docType: 'naval_letter',
    ssic: '1700',
    subject: 'REQUEST MAST',
    paragraphs: [
      { text: 'Request. Per reference (a), I respectfully request mast with the Commanding Officer.', level: 0 },
      { text: 'Nature of Request. [Clearly state the issue or matter you wish to discuss. Be specific but professional. Include relevant dates and circumstances.]', level: 0 },
      { text: 'Chain of Command Actions. [Describe what actions you have taken to resolve this matter through the chain of command, including dates and outcomes of those discussions.]', level: 0 },
      { text: 'Desired Resolution. [State what outcome or resolution you are seeking from the Commanding Officer.]', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'Article 1150, U.S. Navy Regulations' },
    ],
  },
  {
    id: 'page11-request',
    name: 'Page 11 Entry Request',
    category: 'Personnel',
    description: 'Request for administrative remarks entry in service record',
    docType: 'naval_letter',
    ssic: '1070',
    subject: 'REQUEST FOR PAGE 11 ENTRY',
    paragraphs: [
      { text: 'Request. Per reference (a), request the following administrative remarks entry be made in the official military personnel file of [RANK FULL NAME].', level: 0 },
      { text: 'Proposed Entry. "[DATE]: [VERBATIM TEXT OF PROPOSED PAGE 11 ENTRY. Use proper format per IRAM.]"', level: 0 },
      { text: 'Justification. [Explain why this entry is necessary and appropriate. Reference supporting documentation if applicable.]', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO P1070.12K' },
    ],
  },
  {
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
  },
  {
    id: 'pft-waiver',
    name: 'PFT/CFT Waiver Request',
    category: 'Personnel',
    description: 'Request for waiver of physical fitness test',
    docType: 'naval_letter',
    ssic: '6100',
    subject: 'REQUEST FOR PFT/CFT WAIVER',
    paragraphs: [
      { text: 'Request. Per reference (a), I request a waiver from the [PFT/CFT] scheduled for [DATE] due to [MEDICAL/ADMINISTRATIVE] reasons.', level: 0 },
      { text: 'Justification. [Explain the circumstances requiring the waiver. If medical, reference medical documentation. If administrative, explain the situation.]', level: 0 },
      { text: 'Alternative Date. I request to complete the [PFT/CFT] on or about [PROPOSED DATE] when [explain when condition will be resolved or situation permits].', level: 0 },
      { text: 'Supporting Documentation. Enclosure (1) provides [medical documentation/supporting documentation] for this request.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO 6100.13A' },
    ],
  },
  {
    id: 'orders-modification',
    name: 'Request for Orders Modification',
    category: 'Personnel',
    description: 'Request to modify PCS or TAD orders',
    docType: 'naval_letter',
    ssic: '1320',
    subject: 'REQUEST FOR ORDERS MODIFICATION',
    paragraphs: [
      { text: 'Request. Per reference (a), I request modification to my orders [ORDER NUMBER] dated [DATE].', level: 0 },
      { text: 'Current Orders. I am currently ordered to report to [GAINING UNIT] NLT [REPORT DATE] for duty as [BILLET].', level: 0 },
      { text: 'Requested Modification. [Clearly state the specific modification requested: change of report date, change of duty station, deletion of dependent travel, etc.]', level: 0 },
      { text: 'Justification. [Provide detailed justification for the modification request. Include any extenuating circumstances or hardship factors.]', level: 0 },
      { text: 'Impact. [Address how this modification will or will not impact the gaining unit or Marine Corps manning requirements.]', level: 0 },
      { text: 'Point of Contact. Point of contact is the undersigned at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO 1320.11' },
    ],
  },
  {
    id: 'humanitarian-transfer',
    name: 'Humanitarian/Hardship Transfer Request',
    category: 'Personnel',
    description: 'Request for humanitarian or hardship reassignment',
    docType: 'naval_letter',
    ssic: '1300',
    subject: 'REQUEST FOR HUMANITARIAN REASSIGNMENT',
    paragraphs: [
      { text: 'Request. Per reference (a), I request humanitarian reassignment to [GEOGRAPHIC AREA/SPECIFIC DUTY STATION] due to [BRIEFLY STATE REASON - family medical emergency, severe family hardship, etc.].', level: 0 },
      { text: 'Current Assignment. I am currently assigned to [UNIT] as [BILLET]. My PRD is [DATE]. I have served at this duty station since [DATE].', level: 0 },
      { text: 'Hardship Circumstances. [Provide detailed explanation of the hardship situation. Include specific circumstances, timeline of events, and why your presence is required.]', level: 0 },
      { text: 'Family Member Information. [Provide information about the affected family member: relationship, location, nature of condition/situation, prognosis if medical, and why other family members cannot provide necessary support.]', level: 0 },
      { text: 'Requested Location. I request assignment to the San Francisco Bay Area to be within reasonable driving distance of affected family member. Units in the area that could utilize my MOS include those at the Presidio of San Francisco or Travis AFB.', level: 0 },
      { text: 'Supporting Documentation. Enclosures provide supporting documentation including [LIST: medical documentation, dependency letters, Red Cross message, etc.].', level: 0 },
      { text: 'Point of Contact. Point of contact is the undersigned at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO 1040.40B' },
    ],
  },
  {
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
  },
  {
    id: 'tad-request',
    name: 'Temporary Additional Duty (TAD) Request',
    category: 'Personnel',
    description: 'Request TAD orders for training, schools, or temporary assignment',
    docType: 'naval_letter',
    ssic: '1320',
    subject: 'REQUEST FOR TEMPORARY ADDITIONAL DUTY ORDERS',
    paragraphs: [
      { text: 'Request. Per reference (a), I request TAD orders for [RANK FULL NAME] to [DESTINATION/SCHOOL/UNIT] for the period of [START DATE] to [END DATE] ([NUMBER] days).', level: 0 },
      { text: 'Purpose. Purpose of TAD: [STATE PURPOSE - e.g., attendance at formal school, temporary augmentation, training exercise, inspection support, etc.]. [If school: Course number, class number, and report date].', level: 0 },
      { text: 'Justification. [EXPLAIN WHY THIS TAD IS NECESSARY. How does it support mission requirements or Marine\'s professional development? Why was this Marine selected?]', level: 0 },
      { text: 'Funding. Funding source: [SPECIFY - e.g., unit OPTAR, TECOM funded, gaining command funded, etc.]. Estimated cost: [AMOUNT] for travel, [AMOUNT] for per diem, [AMOUNT] total.', level: 0 },
      { text: 'Impact. [ADDRESS IMPACT ON UNIT. How will billet/duties be covered during absence? Any mission degradation concerns?]', level: 0 },
      { text: 'Point of Contact. Point of contact is SSgt J. Doe at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'JTR' },
    ],
  },

  // === AWARDS ===
  {
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
  },
  {
    id: 'award-loa',
    name: 'Letter of Appreciation',
    category: 'Awards',
    description: 'Formal letter of appreciation for outstanding service',
    docType: 'naval_letter',
    ssic: '1650',
    subject: 'LETTER OF APPRECIATION',
    paragraphs: [
      { text: 'I would like to express my sincere appreciation for your outstanding performance and dedication to duty while serving as [BILLET] from [START DATE] to [END DATE].', level: 0 },
      { text: '[Describe specific accomplishments, highlighting 2-3 key achievements and their positive impact on the unit or mission.]', level: 0 },
      { text: 'Your professionalism, initiative, and commitment to excellence reflect great credit upon yourself and [UNIT NAME]. I wish you continued success and Semper Fidelis.', level: 0 },
    ],
  },
  {
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
  },
  {
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
  },
  {
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
  },

  // === LEADERSHIP ===
  {
    id: 'counseling-positive',
    name: 'Counseling (Positive)',
    category: 'Leadership',
    description: 'Documented positive counseling for outstanding performance',
    docType: 'mfr',
    ssic: '1610',
    subject: 'POSITIVE COUNSELING',
    paragraphs: [
      { text: 'Purpose. To formally recognize and document your outstanding performance and positive contributions to the unit.', level: 0 },
      { text: 'Observation. [Describe the specific positive behavior, accomplishment, or performance observed. Include date(s) and circumstances.]', level: 0 },
      { text: 'Impact. [Explain the positive impact this had on the unit, mission accomplishment, or fellow Marines.]', level: 0 },
      { text: 'Recommendation. Continue to maintain this high standard of performance. Your dedication and professionalism set the example for others to follow.', level: 0 },
    ],
  },
  {
    id: 'counseling-negative',
    name: 'Counseling (Corrective)',
    category: 'Leadership',
    description: 'Documented corrective counseling for deficiencies',
    docType: 'mfr',
    ssic: '1610',
    subject: 'CORRECTIVE COUNSELING',
    paragraphs: [
      { text: 'Purpose. To formally document a deficiency in your performance/conduct and establish clear expectations for immediate improvement.', level: 0 },
      { text: 'Observation. [Describe the specific deficiency observed. Include date, time, location, and circumstances. Be factual and specific.]', level: 0 },
      { text: 'Standard. [Cite the applicable standard, order, regulation, or policy that was not met. Reference specific MCO, unit SOP, or UCMJ article if applicable.]', level: 0 },
      { text: 'Impact. [Explain how this deficiency negatively affected or could affect unit readiness, good order and discipline, or mission accomplishment.]', level: 0 },
      { text: 'Expectation. You are expected to correct this deficiency immediately and ensure it does not recur. Failure to improve may result in adverse administrative or disciplinary action.', level: 0 },
      { text: 'Assistance. [Identify any assistance, resources, or training available to help the Marine improve. Include mentor assignment if applicable.]', level: 0 },
      { text: 'Acknowledgment. Your signature below acknowledges receipt of this counseling. It does not indicate agreement or disagreement with its contents.', level: 0 },
    ],
  },
  {
    id: 'command-interest',
    name: 'Command Interest Letter',
    category: 'Leadership',
    description: 'Letter expressing command interest in a Marine\'s development',
    docType: 'naval_letter',
    ssic: '1610',
    subject: 'COMMAND INTEREST',
    paragraphs: [
      { text: 'Purpose. This letter establishes command interest in [RANK FULL NAME] to ensure proper mentorship and career development.', level: 0 },
      { text: 'Background. [Explain why command interest is being established: performance concerns, development potential, recent personal difficulties, or other relevant circumstances.]', level: 0 },
      { text: 'Expectations. [Outline specific expectations for the Marine during the command interest period. Include performance standards, behavior requirements, or development goals.]', level: 0 },
      { text: 'Mentorship. [MENTOR\'S RANK AND NAME] is assigned as mentor and will provide weekly counseling and guidance. Mentor will report progress to the First Sergeant monthly.', level: 0 },
      { text: 'Duration. This command interest will remain in effect for [PERIOD] or until removed by the Commanding Officer, whichever occurs first.', level: 0 },
    ],
  },
  {
    id: '6105-entry',
    name: '6105 Counseling Entry Request',
    category: 'Leadership',
    description: 'Request for adverse page 11 entry (6105)',
    docType: 'naval_letter',
    ssic: '1610',
    subject: 'REQUEST FOR ADMINISTRATIVE REMARKS (6105) ENTRY',
    paragraphs: [
      { text: 'Request. Per references (a) and (b), request the following 6105 counseling entry be made in the service record of [RANK FULL NAME].', level: 0 },
      { text: 'Incident. [Describe the specific incident, deficiency, or pattern of behavior that warrants this entry. Include dates, locations, and factual description of events.]', level: 0 },
      { text: 'Standard Violated. [Cite the specific order, regulation, policy, or standard that was violated. Reference UCMJ articles if applicable.]', level: 0 },
      { text: 'Prior Counseling. [Document prior counseling efforts, including dates and outcomes. Reference any previous page 11 entries or documented counseling sessions.]', level: 0 },
      { text: 'Proposed Entry. "[DATE]: Per MCO 1610.7A, you are being formally counseled for [BRIEF DESCRIPTION]. [DETAILED NARRATIVE]. Failure to correct this deficiency may result in further adverse administrative or disciplinary action, to include [POTENTIAL CONSEQUENCES]."', level: 0 },
      { text: 'Marine\'s Rights. Per reference (a), the Marine has been advised of the right to submit a written statement within 10 working days. The statement will be filed with this entry.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO 1610.7A' },
      { letter: 'b', title: 'MCO 1070.12K' },
    ],
  },
  {
    id: 'loi',
    name: 'Letter of Instruction',
    category: 'Leadership',
    description: 'Formal letter providing specific instructions or guidance',
    docType: 'mfr',
    ssic: '5000',
    subject: 'LETTER OF INSTRUCTION',
    paragraphs: [
      { text: 'Purpose. This letter provides instructions and guidance for [EVENT/TASK/OPERATION/PROGRAM].', level: 0 },
      { text: 'Background. [Provide context and background information necessary to understand the requirement.]', level: 0 },
      { text: 'Scope. [Define what is covered by these instructions, including applicable personnel, timeframes, and geographic areas.]', level: 0 },
      { text: 'Instructions. [Provide detailed, numbered instructions. Be specific about who, what, when, where, and how. Include specific tasks, responsibilities, and deadlines.]', level: 0 },
      { text: 'Coordination. [Identify coordination requirements, reporting chains, and key personnel involved.]', level: 0 },
      { text: 'Resources. [Identify resources available, funding sources, equipment, or personnel support.]', level: 0 },
      { text: 'Point of Contact. Point of contact for this matter is SSgt J. Doe at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
    ],
  },

  // === ENDORSEMENTS ===
  {
    id: 'endorsement-approve',
    name: 'Endorsement (Recommend Approval)',
    category: 'Endorsements',
    description: 'Endorsement recommending approval of a request',
    docType: 'same_page_endorsement',
    subject: '',
    paragraphs: [
      { text: '[Provide supporting justification for approval. Include any relevant information not contained in the basic letter that supports the request.]', level: 0 },
    ],
  },
  {
    id: 'endorsement-disapprove',
    name: 'Endorsement (Recommend Disapproval)',
    category: 'Endorsements',
    description: 'Endorsement recommending disapproval of a request',
    docType: 'same_page_endorsement',
    subject: '',
    paragraphs: [
      { text: '[Provide specific reasons for recommending disapproval. Be factual and professional. Reference applicable policies or regulations if relevant.]', level: 0 },
    ],
  },
  {
    id: 'endorsement-info',
    name: 'Endorsement (For Information)',
    category: 'Endorsements',
    description: 'Endorsement forwarding without recommendation',
    docType: 'new_page_endorsement',
    subject: '',
    paragraphs: [
      { text: '[Provide any additional information or context relevant to the basic letter. State if no additional comments or recommendations are required at this level.]', level: 0 },
    ],
  },
  {
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
  },

  // === TRAINING ===
  {
    id: 'training-request',
    name: 'Training Request',
    category: 'Training',
    description: 'Request for formal school or training course',
    docType: 'naval_letter',
    ssic: '1500',
    subject: 'REQUEST FOR TRAINING',
    paragraphs: [
      { text: 'Request. Per reference (a), I request authorization to attend [COURSE NAME] ([COURSE NUMBER if applicable]) conducted at the Presidio of San Francisco, CA from [START DATE] to [END DATE].', level: 0 },
      { text: 'Justification. [Explain how this training supports your current billet, MOS requirements, or career development. Describe how the unit will benefit from this training.]', level: 0 },
      { text: 'Funding. [Address funding requirements: TDY costs, course fees, etc. Identify source of funding if known.]', level: 0 },
      { text: 'Impact. My absence during this training period [will/will not] impact unit operations. [If applicable: explain how duties will be covered.]', level: 0 },
      { text: 'Point of Contact. Point of contact for this request is the undersigned at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO 1500.52' },
    ],
  },

  // === ADMINISTRATIVE ===
  {
    id: 'gtcc-request',
    name: 'Government Travel Card Request',
    category: 'Administrative',
    description: 'Request for Government Travel Charge Card',
    docType: 'mfr',
    ssic: '4600',
    subject: 'REQUEST FOR GOVERNMENT TRAVEL CHARGE CARD',
    paragraphs: [
      { text: 'Request. Per reference (a), I request issuance of a Government Travel Charge Card (GTCC) for official travel purposes.', level: 0 },
      { text: 'Justification. A GTCC is required to support upcoming TAD orders to the Presidio of San Francisco, CA scheduled for [DATE]. My duties require frequent official travel that necessitates a GTCC.', level: 0 },
      { text: 'Acknowledgment. I acknowledge that I have completed the required GTCC training and understand my responsibilities as a cardholder per reference (a).', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'DoD 7000.14-R, Vol. 9' },
    ],
  },
  {
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
  },
  {
    id: 'sgli-update',
    name: 'SGLI Beneficiary Update',
    category: 'Administrative',
    description: 'Notification of SGLI beneficiary change',
    docType: 'naval_letter',
    ssic: '1750',
    subject: 'SERVICEMEMBERS\' GROUP LIFE INSURANCE (SGLI) BENEFICIARY UPDATE',
    paragraphs: [
      { text: 'Purpose. Per reference (a), this letter confirms my election to update my SGLI beneficiary designation.', level: 0 },
      { text: 'Coverage. I currently maintain SGLI coverage in the amount of [AMOUNT]. I have elected to [maintain/increase/decrease] my coverage to [AMOUNT].', level: 0 },
      { text: 'Beneficiary Designation. Enclosure (1) is my updated SGLV 8286 designating my beneficiaries as indicated therein.', level: 0 },
      { text: 'Acknowledgment. I understand this designation supersedes all previous beneficiary designations and will remain in effect until modified or revoked by me in writing.', level: 0 },
    ],
    references: [
      { letter: 'a', title: '38 U.S.C. Chapter 19' },
    ],
  },
  {
    id: 'appointment-collateral-duty',
    name: 'Appointment to Collateral Duty',
    category: 'Administrative',
    description: 'Appoint a Marine to a collateral duty position',
    docType: 'naval_letter',
    ssic: '5216',
    subject: 'APPOINTMENT TO COLLATERAL DUTY',
    paragraphs: [
      { text: 'Appointment. Effective [DATE], you are hereby appointed as the [DUTY TITLE] for [UNIT NAME].', level: 0 },
      { text: 'Responsibilities. Your responsibilities include but are not limited to: [LIST PRIMARY DUTIES AND RESPONSIBILITIES]. You will serve as the primary point of contact for all matters pertaining to this duty.', level: 0 },
      { text: 'Authority. You are authorized to [LIST SPECIFIC AUTHORITIES GRANTED - e.g., sign for equipment, access spaces, approve requests, etc.]. Exercise this authority in accordance with applicable regulations and command policies.', level: 0 },
      { text: 'Training. Ensure completion of all required training for this duty within [NUMBER] days of this appointment. Coordinate with [PERSON/OFFICE] for scheduling and certification.', level: 0 },
      { text: 'Turnover. Maintain complete and accurate records. Upon relief, conduct a thorough turnover with your replacement and provide a turnover folder containing all relevant documents, SOPs, and points of contact.', level: 0 },
      { text: 'Duration. This appointment remains in effect until relieved in writing or upon your departure from this command.', level: 0 },
    ],
  },
  {
    id: 'appointment-board-member',
    name: 'Appointment to Board/Committee',
    category: 'Administrative',
    description: 'Appoint a member to a selection, promotion, or administrative board',
    docType: 'naval_letter',
    ssic: '5216',
    subject: 'APPOINTMENT TO [BOARD/COMMITTEE NAME]',
    paragraphs: [
      { text: 'Appointment. Per reference (a), you are hereby appointed as a [VOTING MEMBER/RECORDER/PRESIDENT] of the [BOARD/COMMITTEE NAME] convening on [DATE] at 0900 in Building 35, Presidio of San Francisco.', level: 0 },
      { text: 'Purpose. The purpose of this board is to [STATE PURPOSE - e.g., review candidates for meritorious promotion, evaluate administrative separation, select personnel for special duty assignment, etc.].', level: 0 },
      { text: 'Composition. The board will consist of: President: [RANK/NAME]; Members: [LIST MEMBERS]; Recorder: [RANK/NAME]. [Additional personnel as required].', level: 0 },
      { text: 'Procedures. Conduct all proceedings in accordance with reference (a). The recorder will maintain accurate minutes and all documentation. All deliberations are confidential and will not be disclosed outside official channels.', level: 0 },
      { text: 'Report. Upon completion of proceedings, submit the board report with findings and recommendations to the undersigned within [NUMBER] working days.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO 1400.32D' },
    ],
  },
  {
    id: 'duty-status-change',
    name: 'Duty Status Change Notification',
    category: 'Administrative',
    description: 'Notify higher headquarters of Marine\'s change in duty status',
    docType: 'naval_letter',
    ssic: '1320',
    subject: 'DUTY STATUS CHANGE NOTIFICATION',
    paragraphs: [
      { text: 'Notification. Per reference (a), the following duty status change is reported for [RANK FULL NAME], [EDIPI], [MOS].', level: 0 },
      { text: 'Status Change. Previous Status: [PRESENT FOR DUTY/TAD/LEAVE/LIMDU/etc.]. New Status: [NEW STATUS]. Effective Date: [DATE].', level: 0 },
      { text: 'Details. [PROVIDE RELEVANT DETAILS. For LIMDU: diagnosis category, estimated return date, duty limitations. For UA: last known location, circumstances, actions taken. For confinement: location, charges, court-martial date if known.]', level: 0 },
      { text: 'Actions Taken. [DESCRIBE COMMAND ACTIONS - e.g., administrative processing initiated, legal hold placed, notification to next of kin, etc.]', level: 0 },
      { text: 'Point of Contact. Point of contact for this matter is SSgt J. Doe at (415) 555-1776 / j.doe@usmc.mil.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO 1001.59A' },
    ],
  },
  {
    id: 'appointment-safety-officer',
    name: 'Appointment as Safety Officer',
    category: 'Administrative',
    description: 'Appoint a unit Safety Officer',
    docType: 'naval_letter',
    ssic: '5100',
    subject: 'APPOINTMENT AS UNIT SAFETY OFFICER',
    paragraphs: [
      { text: 'Appointment. Effective [DATE], you are hereby appointed as the Unit Safety Officer for [UNIT NAME].', level: 0 },
      { text: 'Responsibilities. Your responsibilities include: (1) implementing and managing the unit safety program per reference (a); (2) conducting safety inspections and risk assessments; (3) investigating mishaps and near-misses; (4) conducting safety training and awareness campaigns; (5) maintaining required safety documentation and reports.', level: 0 },
      { text: 'Authority. You are authorized to: halt any operation presenting imminent danger; access all spaces and operations for safety inspections; direct immediate corrective actions for safety hazards; and report directly to the Commanding Officer on safety matters.', level: 0 },
      { text: 'Training Requirements. Complete the following training within 90 days: (1) [SERVICE] Safety Officer Course; (2) Operational Risk Management (ORM) Course; (3) Mishap Investigation Course. Document all certifications and maintain currency.', level: 0 },
      { text: 'Coordination. Coordinate with higher headquarters safety personnel and participate in all safety working groups and inspections as required.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'MCO 5100.29B' },
    ],
  },

  // === INVESTIGATIONS ===
  {
    id: 'report-findings',
    name: 'Report of Findings',
    category: 'Investigations',
    description: 'Formal report documenting investigation findings',
    docType: 'naval_letter',
    ssic: '5830',
    subject: 'REPORT OF PRELIMINARY INQUIRY',
    paragraphs: [
      { text: 'Authority. Per reference (a), a preliminary inquiry was conducted into [SUBJECT MATTER] as directed by [CONVENING AUTHORITY] on [DATE].', level: 0 },
      { text: 'Background. [Provide background information and circumstances that prompted the inquiry. Include dates, locations, and personnel involved.]', level: 0 },
      { text: 'Methodology. [Describe how the inquiry was conducted: witnesses interviewed, documents reviewed, evidence examined, etc.]', level: 0 },
      { text: 'Findings of Fact. [List specific findings based on evidence gathered. Use numbered sub-paragraphs for clarity. Be objective and factual.]', level: 0 },
      { text: 'Conclusion. [State conclusions drawn from the findings. Address whether allegations were substantiated or unsubstantiated.]', level: 0 },
      { text: 'Recommendation. [Provide recommendations for action: further investigation, administrative action, disciplinary action, case closure, or other appropriate disposition.]', level: 0 },
    ],
    references: [
      { letter: 'a', title: '[Convening authority directive or appointing order]' },
    ],
  },
  {
    id: 'appointment-investigating-officer',
    name: 'Appointment as Investigating Officer',
    category: 'Investigations',
    description: 'Appoint an officer or SNCO to conduct a command investigation',
    docType: 'naval_letter',
    ssic: '5830',
    subject: 'APPOINTMENT AS INVESTIGATING OFFICER',
    paragraphs: [
      { text: 'Appointment. Per references (a) and (b), you are hereby appointed as Investigating Officer (IO) to conduct a command investigation into [BRIEF DESCRIPTION OF INCIDENT/MATTER].', level: 0 },
      { text: 'Scope. You are directed to investigate the facts and circumstances surrounding [DETAILED DESCRIPTION]. This investigation should determine [LIST SPECIFIC QUESTIONS TO BE ANSWERED].', level: 0 },
      { text: 'Authority. You are authorized to interview all personnel who may have relevant information, examine all pertinent documents and physical evidence, and take sworn statements as necessary. All members of this command are directed to cooperate fully with this investigation.', level: 0 },
      { text: 'Timeline. Submit your findings of fact, opinions, and recommendations to the undersigned no later than [DATE], unless an extension is requested and approved.', level: 0 },
      { text: 'Report Format. Your report should include: (1) preliminary statement identifying the appointment authority and scope; (2) findings of fact; (3) opinions; (4) recommendations; and (5) all enclosures including witness statements and documentary evidence.', level: 0 },
      { text: 'Legal Review. Upon completion, your investigation will be forwarded to the Staff Judge Advocate for legal sufficiency review prior to final action.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'JAGMAN Chapter II' },
      { letter: 'b', title: 'MCO 5830.8A' },
    ],
  },

  // === LEGAL ===
  {
    id: 'legal-hold',
    name: 'Legal Hold Notification',
    category: 'Legal',
    description: 'Notification of litigation hold on documents/evidence',
    docType: 'mfr',
    ssic: '5800',
    subject: 'LITIGATION HOLD NOTICE',
    paragraphs: [
      { text: 'Notice. This memorandum serves as official notice of a litigation hold effective immediately. You are required to preserve all documents, records, and electronically stored information (ESI) related to [SUBJECT MATTER/CASE NAME].', level: 0 },
      { text: 'Scope. This hold applies to all documents and information, regardless of format, related to [DESCRIBE SCOPE: specific incident, time period, individuals, or subject matter]. This includes but is not limited to emails, text messages, photographs, videos, reports, notes, and any other records.', level: 0 },
      { text: 'Preservation Requirements. You must immediately: (1) Suspend any routine destruction of relevant documents; (2) Preserve all relevant electronic communications including emails, texts, and voicemails; (3) Preserve all relevant physical documents; (4) Preserve any relevant evidence in your possession or control.', level: 0 },
      { text: 'Prohibition. Do NOT delete, destroy, alter, or dispose of any potentially relevant documents or information. Failure to comply with this hold may result in adverse legal consequences and potential disciplinary action.', level: 0 },
      { text: 'Duration. This litigation hold will remain in effect until you receive written notice of its release. Do not assume the hold has been lifted unless you receive official notification.', level: 0 },
      { text: 'Questions. Direct any questions regarding this hold to the Staff Judge Advocate at (415) 555-1849 / sja@usmc.mil.', level: 0 },
    ],
    references: [
      { letter: 'a', title: 'JAGMAN' },
    ],
  },
  {
    id: 'notarized-statement',
    name: 'Statement Under Oath',
    category: 'Legal',
    description: 'Format for sworn statement in investigations',
    docType: 'mfr',
    ssic: '5830',
    subject: 'SWORN STATEMENT',
    paragraphs: [
      { text: 'I, [FULL NAME], [RANK/RATE if applicable], having been duly sworn, do hereby state the following:', level: 0 },
      { text: '[PROVIDE DETAILED STATEMENT OF FACTS. Include: who was involved, what happened, when it occurred, where it took place, and any other relevant details. Be specific and factual. Avoid opinions unless specifically requested.]', level: 0 },
      { text: '[CONTINUE STATEMENT AS NEEDED. Use separate paragraphs for different events or topics. Include any physical evidence observed, documents reviewed, or statements heard from others (attribute properly).]', level: 0 },
      { text: 'I have read this statement consisting of [NUMBER] pages. I fully understand its contents. This statement is true and correct to the best of my knowledge and belief.', level: 0 },
    ],
  },

  // === MEMORANDA ===
  {
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
  },

  // === OPERATIONS ===
  {
    id: 'letter-of-instruction-ops',
    name: 'Letter of Instruction (Operations)',
    category: 'Operations',
    description: 'Formal instructions for an event or operation',
    docType: 'naval_letter',
    subject: 'LETTER OF INSTRUCTION FOR [EVENT/OPERATION NAME]',
    paragraphs: [
      { text: 'Situation. [DESCRIBE THE EVENT OR REQUIREMENT]', level: 0 },
      { text: 'Mission. [STATE THE MISSION OR OBJECTIVE]', level: 0 },
      { text: 'Execution:', level: 0 },
      { text: 'Commander\'s Intent. [STATE INTENT]', level: 1 },
      { text: 'Concept of Operations. [DESCRIBE HOW THE MISSION WILL BE ACCOMPLISHED]', level: 1 },
      { text: 'Tasks:', level: 1 },
      { text: '[TASK 1 - RESPONSIBLE UNIT/PERSON]', level: 2 },
      { text: '[TASK 2 - RESPONSIBLE UNIT/PERSON]', level: 2 },
      { text: 'Coordinating Instructions:', level: 1 },
      { text: 'Timeline: [KEY DATES/TIMES]', level: 2 },
      { text: 'Uniform: [IF APPLICABLE]', level: 2 },
      { text: 'Admin/Logistics. [DESCRIBE SUPPORT REQUIREMENTS]', level: 0 },
      { text: 'Command/Signal. POC is SSgt J. Doe at j.doe@usmc.mil / (415) 555-1776.', level: 0 },
    ],
  },
];

const CATEGORIES = [...new Set(LETTER_TEMPLATES.map(t => t.category))];

export function TemplateLoaderModal() {
  const { templateLoaderOpen, setTemplateLoaderOpen } = useUIStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<LetterTemplate | null>(null);

  const filteredTemplates = useMemo(() => {
    return LETTER_TEMPLATES.filter((template) => {
      const matchesSearch = !searchQuery ||
        template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (template.ssic && template.ssic.includes(searchQuery));

      const matchesCategory = !selectedCategory || template.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  const handleLoadTemplate = () => {
    if (!selectedTemplate) return;

    const store = useDocumentStore.getState();

    // Set document type
    store.setDocType(selectedTemplate.docType);

    // Set subject
    if (selectedTemplate.subject) {
      store.setField('subject', selectedTemplate.subject);
    }

    // Set SSIC if available
    if (selectedTemplate.ssic) {
      store.setField('ssic', selectedTemplate.ssic);
    }

    // Clear existing paragraphs by removing from the end (avoids index shifting issues)
    const currentParagraphCount = store.paragraphs.length;
    for (let i = currentParagraphCount - 1; i >= 0; i--) {
      store.removeParagraph(i);
    }

    // Add template paragraphs
    selectedTemplate.paragraphs.forEach((para) => {
      store.addParagraph(para.text, para.level);
    });

    // Clear existing references by removing from the end
    const currentRefCount = store.references.length;
    for (let i = currentRefCount - 1; i >= 0; i--) {
      store.removeReference(i);
    }

    // Add template references
    if (selectedTemplate.references) {
      selectedTemplate.references.forEach((ref) => {
        store.addReference(ref.title, ref.url);
      });
    }

    // Clear existing enclosures
    const currentEnclCount = store.enclosures.length;
    for (let i = currentEnclCount - 1; i >= 0; i--) {
      store.removeEnclosure(i);
    }

    // Clear existing copy-tos
    const currentCopyToCount = store.copyTos.length;
    for (let i = currentCopyToCount - 1; i >= 0; i--) {
      store.removeCopyTo(i);
    }

    // Close modal and reset state
    setTemplateLoaderOpen(false);
    setSelectedTemplate(null);
    setSearchQuery('');
    setSelectedCategory(null);
  };

  const handleClose = () => {
    setTemplateLoaderOpen(false);
    setSelectedTemplate(null);
    setSearchQuery('');
    setSelectedCategory(null);
  };

  return (
    <Dialog open={templateLoaderOpen} onOpenChange={setTemplateLoaderOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="bg-background px-6 py-4 border-b shrink-0 z-10">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Load Template
            <span className="text-xs text-muted-foreground font-normal ml-2">
              {LETTER_TEMPLATES.length} templates
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 border-b shrink-0 space-y-3 bg-background z-10">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates by name, description, or SSIC..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Category filters */}
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={selectedCategory === null ? 'default' : 'outline'}
              className="cursor-pointer hover:bg-primary/80"
              onClick={() => setSelectedCategory(null)}
            >
              All
            </Badge>
            {CATEGORIES.map((category) => (
              <Badge
                key={category}
                variant={selectedCategory === category ? 'default' : 'outline'}
                className="cursor-pointer hover:bg-primary/80"
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-4 grid gap-2">
            {filteredTemplates.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No templates found matching your search.
              </div>
            ) : (
              filteredTemplates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template)}
                  className={`w-full text-left p-4 rounded-lg border transition-colors ${
                    selectedTemplate?.id === template.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{template.name}</span>
                        {selectedTemplate?.id === template.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {template.description}
                      </p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {template.category}
                        </Badge>
                        {template.ssic && (
                          <Badge variant="outline" className="text-xs">
                            SSIC {template.ssic}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {template.paragraphs.length} para{template.paragraphs.length !== 1 ? 's' : ''}
                          {template.references && ` • ${template.references.length} ref${template.references.length !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {selectedTemplate && (
          <div className="p-4 border-t bg-muted/50 shrink-0 z-10">
            <div className="text-sm">
              <span className="font-medium">Preview:</span>
              <p className="text-muted-foreground mt-1">
                {selectedTemplate.subject || '(No subject - endorsement)'}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                This will replace your current document content.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="bg-background px-6 py-4 border-t shrink-0 z-10">
          <Button
            variant="outline"
            onClick={handleClose}
            className="hover:bg-accent"
          >
            Cancel
          </Button>
          <Button
            onClick={handleLoadTemplate}
            disabled={!selectedTemplate}
            className="hover:bg-primary/90"
          >
            <FileText className="h-4 w-4 mr-2" />
            Load Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
