import { manualPacket } from './manualPacket';
import type { PublicationWordSource } from '@/services/docx/publication';
import { companionPublication } from './companionPublication';
import { toStore } from '../../companion/letterInput';
import { statSync } from 'node:fs';
import { sl3Fixture } from './sl3Fixture';
import { sl4Fixture } from './sl4Fixture';

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

export function stockWordSource(docType: 'sl3' | 'sl4' = 'sl3'): PublicationWordSource {
  const source = docType === 'sl3' ? sl3Fixture() : sl4Fixture();
  if (docType === 'sl4') {
    const figure = source.paragraphs[0].figure!;
    figure.name = 'diagram.png'; figure.type = 'image/png';
    figure.altText = 'Synthetic training control box with two empty component outlines';
    figure.fileRef = { id: 'sl4-artwork', name: 'diagram.png', type: 'image/png', size: statSync('tests/fixtures/publication-word/diagram.png').size };
  }
  return { ...source, endItems: source.endItems ?? [], publicationTables: {} };
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
  const sl3 = stockWordSource(), wide = stockWordSource();
  wide.formData.sl3!.orientation = 'landscape';
  wide.formData.sl3!.showFigureReference = true;
  wide.formData.sl3!.showModel = true;
  wide.formData.sl3!.fieldingPlanReference = 'SYNTHETIC FIELDING PLAN';
  wide.formData.sl3!.components[0].figureReference = 'A1';
  wide.formData.sl3!.components[0].model = 'MODEL-WIDE';
  const sl4 = stockWordSource('sl4');
  return [
    { name: 'manual-standard', source: normal, markers: ['PORTABLE TEST EQUIPMENT', 'TEST-001', 'MODEL-1', 'DISTRIBUTION STATEMENT A', 'A. SAMPLE'] },
    { name: 'manual-continuation', source: continuation, markers: ['INTERACTIVE CONTROLLER MAINTENANCE', 'END ITEM CONTINUATION', 'TEST-009', 'MODEL-9', 'A. SAMPLE'] },
    { name: 'manual-controlled', source: controlled, markers: ['Controlled by:', 'DISTRIBUTION STATEMENT C', 'DESTRUCTION NOTICE', 'Copyright 2026 Example Company.', 'TEST-007', 'A. SAMPLE'] },
    { name: 'sl3-portrait', source: sl3, markers: ['COMPONENT, Training 001', 'COMPONENTS INVENTORY', 'INVENTORIED BY'] },
    { name: 'sl3-wide', source: wide, markers: ['COMPONENT, Training 001', 'MODEL-WIDE', 'SYNTHETIC FIELDING PLAN', 'INVENTORIED BY'] },
    { name: 'sl4-parts', source: sl4, markers: ['PART I', 'PART II', 'PART III', 'PART IV', 'Control Box, Training'], assetFiles: { 'sl4-artwork': 'tests/fixtures/publication-word/diagram.png' } },
    ...instructions,
    { name: 'instruction-rich', source: rich, markers: ['SUPPORT BRACKET', 'INSPECTION', 'CALIBRATION', 'Controller inspection drawing', 'APPENDIX INTRODUCTION', 'APPENDIX CONTENT'], assetFiles: { 'qualification-image': 'public/attachments/usmc-seal.png' } },
  ];
}
