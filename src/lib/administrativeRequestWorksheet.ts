import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { compileFormDefinition, type FormDefinition } from '@/services/forms/model';
import { portableResourceDigest } from './portableResources';

const fields = [
  { id: 'subject', label: 'Request subject', top: 690, height: 30 },
  { id: 'requester', label: 'Requester', top: 630, height: 28 },
  { id: 'organization', label: 'Organization', top: 574, height: 28 },
  { id: 'recipient', label: 'Recipient', top: 518, height: 28 },
  { id: 'requestDate', label: 'Request date', top: 462, height: 28 },
  { id: 'ssic', label: 'SSIC', top: 406, height: 28 },
  { id: 'details', label: 'Requested action and justification', top: 350, height: 250 },
] as const;

/** Clean maintained content only. No personal data or local document enters the template. */
export async function administrativeRequestWorksheet(): Promise<{ definition: FormDefinition; bytes: Uint8Array }> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date(0)); pdf.setModificationDate(new Date(0));
  pdf.setProducer('DonDocs'); pdf.setCreator('DonDocs');
  pdf.setTitle('DonDocs request details worksheet');
  const page = pdf.addPage([612, 792]), font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('DonDocs request details worksheet', { x: 48, y: 748, font: bold, size: 17 });
  page.drawText('General request starter. Supporting worksheet, not an official form.', { x: 48, y: 728, font, size: 10 });
  for (const field of fields) {
    page.drawText(field.label, { x: 48, y: field.top + 8, font: bold, size: 10 });
    page.drawRectangle({ x: 48, y: field.top - field.height, width: 516, height: field.height,
      borderWidth: 0.5, borderColor: rgb(0.55, 0.55, 0.55) });
  }
  page.drawText('Check applicable routing, evidence and signing requirements before submission.', { x: 48, y: 62, font, size: 9 });
  const bytes = await pdf.save();
  const sha256 = await portableResourceDigest(new Uint8Array(bytes).buffer);
  const definition = compileFormDefinition({ schemaVersion: 2, formId: 'dondocs_request_details',
    label: 'DonDocs request details worksheet', definitionRevision: '1', templateRevision: '1',
    directory: 'dondocs-request-details', pages: [{ file: 'page1.pdf', width: 612, height: 792, sha256 }],
    fields: Object.fromEntries(fields.map(field => [field.id, { kind: field.id === 'requestDate' ? 'date' : field.id === 'ssic' ? 'identifier' : 'text',
      label: field.label, requiredAt: 'export', ...(field.id === 'details' ? { multiline: true } : {}) }])),
    sections: [{ id: 'request-details', title: 'Request details', fields: fields.map(field => field.id) }], rowGroups: {},
    placements: fields.map(field => ({ fieldId: field.id, page: 1, box: { left: 48, top: field.top, width: 516, height: field.height },
      appearance: 'text', overflow: 'error', ...(field.id === 'requestDate' ? { dateFormat: 'iso' } : {}) })),
  });
  return { definition, bytes };
}
