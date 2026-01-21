import type { LetterTemplate } from '../types';

export const humanitarianTransfer: LetterTemplate = {
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
};
