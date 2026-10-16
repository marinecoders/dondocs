import type { LetterInput } from '../../companion/letterInput';
import { DISCREPANCY_NOTICE, MI_REPORTING } from '../../src/data/techpub/sections';

export function companionPublication(type: 'MI' | 'TI' | 'SI' | 'LI' = 'MI'): LetterInput {
  const name = { MI: 'Modification', TI: 'Technical', SI: 'Supply', LI: 'Lubrication' }[type];
  return {
    docType: 'i_type', subject: 'INSPECT THE SUPPORT BRACKET', date: '30 Oct 26',
    unit: { name: 'MARINE CORPS SYSTEMS COMMAND', address: '2200 LESTER STREET, QUANTICO VA 22134' },
    signature: { first: 'Jane', last: 'Doe', title: 'Program Manager' },
    publication: {
      type, shortTitle: `${type} 12345A-26/1`, pcn: '184 123456 00', nomenclature: 'SUPPORT EQUIPMENT',
      controllingOffice: 'Program Office', signingDate: '2026-10-15', distribution: { statement: 'A' },
      endItems: [{ nsn: '1005-01-566-1100', tamcn: 'A02557G', id: '12345A', model: 'SUPPORT BRACKET' }],
    },
    paragraphs: [
      { level: 0, publicationSection: 'purpose', header: 'Purpose', text: 'Inspect the support bracket.' },
      { level: 0, publicationSection: 'administration', header: 'Administrative Instructions',
        text: `For questions or concerns with the content or procedures in this ${name} Instruction (${type}) contact office@example.mil. ${DISCREPANCY_NOTICE}${type === 'MI' ? ' ' + MI_REPORTING : ''}` },
    ],
  };
}
