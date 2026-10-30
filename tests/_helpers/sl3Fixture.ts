import { buildBaseline } from './compileMatrix';
import { emptySl3, newSl3Component } from '@/data/techpub/sl3';
import type { EndItem } from '@/types/document';

export function sl3Fixture(count = 3) {
  const store = buildBaseline('i_type') as ReturnType<typeof buildBaseline> & {
    endItems: EndItem[];
  };
  store.docType = 'sl3';
  Object.assign(store.formData, {
    shortTitle: 'SL-3-12345A',
    pcn: '123 123450 00',
    nomenclature: 'TOOL KIT, TRAINING',
    subject: 'COMPONENTS LIST FOR TRAINING TOOL KIT',
    date: '30 Oct 26',
    publicationSigningDate: '2026-10-30',
    fontFamily: 'times',
    fontSize: '10pt',
    signatureType: 'digital',
    sigFirst: 'Jane',
    sigLast: 'Example',
    sigTitle: 'Program Manager',
    unitLine1: 'EXAMPLE COMMAND',
    controllingOffice: 'Example Program Office',
    pocEmail: 'example@example.com',
    classLevel: 'unclassified',
    cuiDistStatement: 'A',
    exportRestricted: false,
    sl3: {
      ...emptySl3(),
      sourceManual: 'TM 12345A-10 (synthetic training manual)',
      technicalData:
        'Training tool kit. Weight: 5 pounds. For demonstration only.',
      components: Array.from({ length: count }, (_, i) => ({
        ...newSl3Component(`component-${i}`),
        nomenclature: `COMPONENT, Training ${String(i + 1).padStart(3, '0')}`,
        nsn: '5120-01-542-7445',
        quantity: '1',
      })),
    },
  });
  store.endItems = [
    {
      nsn: '5120-01-542-7445',
      tamcn: 'A12345G',
      id: '12345A',
      model: 'TRAINING',
    },
  ];
  store.paragraphs = [];
  store.enclosures = [];
  store.references = [];
  store.copyTos = [];
  store.distributions = [];
  return store;
}
