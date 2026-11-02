import { sl4Example } from './techpub/sl4Examples';
import type { ExampleDocument } from './exampleDocuments';

export const sl4PublicationExample: ExampleDocument = {
  id: 'sl4-example', name: 'SL-4 Repair Parts List', category: 'Technical Publications', docType: 'sl4',
  description: 'Fictional control box with a kit, repeated repair parts and generated cross-references',
  formData: {
    unitLine1: 'EXAMPLE COMMAND', unitLine2: 'TRAINING PROGRAM OFFICE', unitAddress: 'EXAMPLE ADDRESS',
    subject: 'REPAIR PARTS LIST FOR TRAINING CONTROL BOX', nomenclature: 'CONTROL BOX, TRAINING',
    shortTitle: 'SL-4-12345A', pcn: '123 123450 00', date: '30 Oct 26', publicationSigningDate: '2026-10-30',
    controllingOffice: 'Training Program Office', pocEmail: 'example@example.com',
    signatureType: 'digital', sigFirst: 'Jane', sigLast: 'Example', sigTitle: 'Program Manager',
    classLevel: 'unclassified', cuiDistStatement: 'A', fontFamily: 'times', fontSize: '10pt', sl4: sl4Example(),
  },
  endItems: [{ nsn: '5895-00-000-0001', tamcn: 'A12345G', id: '12345A', model: 'TRAINING' }],
  references: [], paragraphs: [], copyTos: [],
};
sl4PublicationExample.formData.sl4!.cutoffDate = '2026-10-30';
