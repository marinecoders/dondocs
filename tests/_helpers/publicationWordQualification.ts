import { manualPacket } from './manualPacket';
import type { PublicationWordSource } from '@/services/docx/publication';
import { companionPublication } from './companionPublication';
import { toStore } from '../../companion/letterInput';
import { statSync } from 'node:fs';

export interface PublicationWordFixture {
  name: string;
  source: PublicationWordSource;
  markers: string[];
  assetFiles?: Record<string, string>;
}

export function instructionWordSource(type: 'MI' | 'TI' | 'SI' | 'LI' = 'TI'): PublicationWordSource {
  const source = toStore(companionPublication(type));
  return { ...source, endItems: source.endItems ?? [], publicationTables: source.publicationTables ?? {} };
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
  const instructions = (['MI', 'TI', 'SI', 'LI'] as const).map(type => ({ name: `instruction-${type.toLowerCase()}`, source: instructionWordSource(type), markers: [`${type} 12345A-26/1`, 'SUPPORT BRACKET', 'END OF INSTRUCTION', 'J. DOE'] }));
  const rich = instructionWordSource('TI');
  const tableId = 'A'.repeat(32);
  rich.paragraphs[0].text = `Inspect using {{PUBREF_T_${tableId}}}.`;
  rich.paragraphs.push({ level: 0, header: 'Major Items Affected', tableKey: 'majorItems', text: '', referenceId: tableId },
    { level: 1, text: '', bodyTable: { rows: [['INSPECTION', 'RESULT'], ['CALIBRATION', 'PASS']], headerRows: 1 } },
    { level: 0, text: 'Controller inspection drawing', figure: { fileRef: { id: 'qualification-image', name: 'drawing.png', type: 'image/png', size: statSync('public/attachments/usmc-seal.png').size }, type: 'image/png', altText: 'Synthetic controller inspection diagram' } },
    { level: 0, appendix: true, header: 'Inspection record', text: 'APPENDIX INTRODUCTION' },
    { level: 0, text: 'APPENDIX CONTENT' });
  rich.publicationTables.majorItems = [{ values: { description: 'SUPPORT BRACKET', nsn: '1005-01-566-1100', tamcn: 'A02557G', id: '12345A' } }];
  return [
    { name: 'manual-standard', source: normal, markers: ['PORTABLE TEST EQUIPMENT', 'TEST-001', 'MODEL-1', 'DISTRIBUTION STATEMENT A', 'A. SAMPLE'] },
    { name: 'manual-continuation', source: continuation, markers: ['INTERACTIVE CONTROLLER MAINTENANCE', 'END ITEM CONTINUATION', 'TEST-009', 'MODEL-9', 'A. SAMPLE'] },
    { name: 'manual-controlled', source: controlled, markers: ['Controlled by:', 'DISTRIBUTION STATEMENT C', 'DESTRUCTION NOTICE', 'Copyright 2026 Example Company.', 'TEST-007', 'A. SAMPLE'] },
    ...instructions,
    { name: 'instruction-rich', source: rich, markers: ['SUPPORT BRACKET', 'INSPECTION', 'CALIBRATION', 'Controller inspection drawing', 'APPENDIX INTRODUCTION', 'APPENDIX CONTENT'], assetFiles: { 'qualification-image': 'public/attachments/usmc-seal.png' } },
  ];
}
