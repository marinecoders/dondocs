import type { LetterInput } from '../../companion/letterInput';
import { sl3Fixture } from './sl3Fixture';

export function companionSl3(): LetterInput {
  const store = sl3Fixture();
  const d = store.formData;
  return {
    docType: 'sl3',
    subject: d.subject,
    date: d.date,
    pocEmail: d.pocEmail,
    unit: { name: d.unitLine1 },
    signature: { first: 'Jane', last: 'Example' },
    publication: {
      type: 'SL3',
      shortTitle: d.shortTitle!,
      pcn: d.pcn!,
      nomenclature: d.nomenclature!,
      controllingOffice: d.controllingOffice!,
      signingDate: '2026-10-30',
      distribution: { statement: 'A' },
      endItems: store.endItems,
      sl3: d.sl3,
    },
    paragraphs: [],
  };
}
