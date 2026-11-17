import { manualPacket } from './manualPacket';
import type { PublicationWordSource } from '@/services/docx/publication';

export interface PublicationWordFixture {
  name: string;
  source: PublicationWordSource;
  markers: string[];
}

export function publicationWordFixtures(): PublicationWordFixture[] {
  const manual = (count = 1): PublicationWordSource => ({ ...manualPacket(count), paragraphs: [], endItems: [], publicationTables: {} });
  const normal = manual();
  const continuation = manual(9);
  continuation.formData.manualFrontMatter!.subtype = 'ietm';
  continuation.formData.subject = 'INTERACTIVE CONTROLLER MAINTENANCE';
  const controlled = manual(7);
  Object.assign(controlled.formData, { classLevel: 'cui', cuiControlledBy: 'Example Command', cuiCategory: 'CTI', cuiDissemination: 'FEDCON', pocEmail: 'sample@example.usmc.mil', cuiDistStatement: 'C', distReason: 'Controlled Technical Information', distDate: '2026-10-01' });
  controlled.formData.manualFrontMatter!.copyrightCredit = 'Copyright 2026 Example Company.';
  controlled.formData.manualFrontMatter!.governmentRights = 'The government has permission under the fictional test contract to publish, reproduce and distribute this synthetic technical material.';
  return [
    { name: 'manual-standard', source: normal, markers: ['PORTABLE TEST EQUIPMENT', 'TEST-001', 'MODEL-1', 'DISTRIBUTION STATEMENT A', 'A. SAMPLE'] },
    { name: 'manual-continuation', source: continuation, markers: ['INTERACTIVE CONTROLLER MAINTENANCE', 'END ITEM CONTINUATION', 'TEST-009', 'MODEL-9', 'A. SAMPLE'] },
    { name: 'manual-controlled', source: controlled, markers: ['Controlled by:', 'DISTRIBUTION STATEMENT C', 'DESTRUCTION NOTICE', 'Copyright 2026 Example Company.', 'TEST-007', 'A. SAMPLE'] },
  ];
}
