import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { compileFormDefinition, type AnswerField, type FormDefinition } from '@/services/forms/model';
import { portableResourceDigest } from './portableResources';

interface WorksheetField { id: string; definition: AnswerField; height?: number }
export interface MaintainedWorksheet { definition: FormDefinition; bytes: Uint8Array }

/** These maintained pages contain labels and geometry only; case answers stay in their owned form instances. */
async function worksheet(id: string, title: string, fields: readonly WorksheetField[]): Promise<MaintainedWorksheet> {
  const document = await PDFDocument.create();
  document.setCreationDate(new Date(0)); document.setModificationDate(new Date(0));
  document.setCreator('DonDocs'); document.setProducer('DonDocs'); document.setTitle(title);
  const page = document.addPage([612, 792]), font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  page.drawText(title, { x: 48, y: 748, font: bold, size: 17 });
  page.drawText('General-purpose DonDocs worksheet. Not an official form.', { x: 48, y: 728, font, size: 10 });
  let top = 690;
  const placements = fields.map(field => {
    const height = field.height ?? 30;
    if (top - height < 90) throw new Error('The maintained worksheet exceeds its supported page layout.');
    page.drawText(field.definition.label, { x: 48, y: top + 8, font: bold, size: 10 });
    page.drawRectangle({ x: 48, y: top - height, width: 516, height, borderWidth: 0.5, borderColor: rgb(0.55, 0.55, 0.55) });
    const placement = { fieldId: field.id, page: 1, box: { left: 48, top, width: 516, height }, appearance: 'text' as const,
      overflow: 'error' as const, ...(field.definition.kind === 'date' ? { dateFormat: 'iso' as const } : {}) };
    top -= height + 24;
    return placement;
  });
  page.drawText('Review routing, evidence and signing requirements for the actual action.', { x: 48, y: 62, font, size: 9 });
  const bytes = await document.save(), sha256 = await portableResourceDigest(new Uint8Array(bytes).buffer);
  return { bytes, definition: compileFormDefinition({ schemaVersion: 2, formId: id, label: title, definitionRevision: '1', templateRevision: '1',
    directory: id.replaceAll('_', '-'), pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256 }],
    fields: Object.fromEntries(fields.map(field => [field.id, field.definition])),
    placements, rowGroups: {}, sections: [{ id: 'details', title: 'Details', fields: fields.map(field => field.id) }] }) };
}
const text = (label: string): AnswerField => ({ kind: 'text', label, requiredAt: 'export' });

export function trainingActivityWorksheet(): Promise<MaintainedWorksheet> {
  return worksheet('dondocs_training_activity', 'DonDocs training activity', [
    { id: 'course', definition: text('Course or activity') },
    { id: 'date', definition: { kind: 'date', label: 'Training date', requiredAt: 'export' } },
    { id: 'purpose', definition: { ...text('Activity purpose'), multiline: true }, height: 250 },
  ]);
}

export function trainingParticipationWorksheet(attendance: 'remote' | 'in-person'): Promise<MaintainedWorksheet> {
  return worksheet(`dondocs_training_${attendance === 'remote' ? 'remote' : 'in_person'}`, 'DonDocs training participation', [
    { id: 'course', definition: text('Course or activity') },
    { id: 'date', definition: { kind: 'date', label: 'Training date', requiredAt: 'export' } },
    { id: 'name', definition: text('Participant name') },
    { id: 'reference', definition: { kind: 'identifier', label: 'Local participant reference', requiredAt: 'export' } },
    { id: 'attendance', definition: { kind: 'singleChoice', label: 'Attendance', requiredAt: 'export', options: [
      { id: 'remote', label: 'Remote' }, { id: 'in-person', label: 'In person' },
    ] } },
    ...(attendance === 'in-person' ? [{ id: 'location', definition: text('In-person location') }] : []),
  ]);
}

export function trainingCostWorksheet(): Promise<MaintainedWorksheet> {
  return worksheet('dondocs_training_estimate', 'DonDocs training cost estimate', [
    { id: 'course', definition: text('Course or activity') },
    { id: 'name', definition: text('Participant name') },
    { id: 'reference', definition: { kind: 'identifier', label: 'Local participant reference', requiredAt: 'export' } },
    { id: 'estimate', definition: { kind: 'decimal', label: 'Estimated cost (USD)', requiredAt: 'export' } },
  ]);
}

export function evidenceSubmissionWorksheet(): Promise<MaintainedWorksheet> {
  return worksheet('dondocs_submission_index', 'DonDocs submission index', [
    { id: 'subject', definition: text('Submission subject') },
    { id: 'submitter', definition: text('Submitter') },
    { id: 'organization', definition: text('Organization') },
    { id: 'recipient', definition: text('Recipient') },
    { id: 'date', definition: { kind: 'date', label: 'Submission date', requiredAt: 'export' } },
    { id: 'ssic', definition: { kind: 'identifier', label: 'SSIC', requiredAt: 'export' } },
    { id: 'category', definition: { kind: 'singleChoice', label: 'Supporting record category', requiredAt: 'export', options: [
      { id: 'supporting-record', label: 'Supporting record' }, { id: 'returned-document', label: 'Returned document' },
    ] } },
    { id: 'notes', definition: { ...text('Record description'), multiline: true }, height: 190 },
  ]);
}
