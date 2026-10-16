import { validatePublicationReferences, REFERENCE_TOKEN } from './publicationReferences';
import { iTypeClassificationErrors } from './iTypeClassification';
import { validatePublicationDate } from './publicationDate';
import { validateMajorItemsOrder } from './majorItemsOrder';
import { tableSpec } from '@/data/techpub/tables';
import { validateIdentifiers } from './identifiers';
import { deriveOverallClassLevel } from './overallClassification';
import { isValid, parseISO } from 'date-fns';
import type { DocumentData, Paragraph, EndItem, PublicationTableRow } from '@/types/document';
import { validateDistributionFillIns, validateReasonForStatement } from './classificationValidation';
import { publicationDate, validateTimeCompliance, withTimeCompliance } from './timeCompliance';
import { validateFigures } from './figures';
import { validateProcedureSteps } from './procedureSteps';
import { validateCalloutOrder, validateUrgencyByType, validatePublicationStructure, validateItemNumbers } from './publicationRules';

interface Publication {
  docType: string;
  formData: Partial<DocumentData>;
  paragraphs: Paragraph[];
  endItems?: EndItem[];
  publicationTables?: Record<string, PublicationTableRow[]>;
}

/** Export checks for incomplete or contradictory data; these do not confer release approval. */
export function iTypeExportErrors(store: Publication): string[] {
  if (store.docType !== 'i_type') return [];
  const d = store.formData;
  const errors: string[] = [];
  errors.push(...iTypeClassificationErrors(d, store.paragraphs));
  for (const [key, label] of Object.entries({ shortTitle: 'Short title', pcn: 'PCN', nomenclature: 'Nomenclature', subject: 'Long title', unitLine1: 'Issuing command', sigLast: 'Signatory', controllingOffice: 'Controlling office' })) {
    if (!String(d[key as keyof DocumentData] ?? '').trim()) errors.push(`${label} is required.`);
  }
  errors.push(...validateIdentifiers({ pcn: d.pcn, shortTitle: d.shortTitle, publicationType: d.publicationType, endItems: store.endItems ?? [], majorItems: store.publicationTables?.majorItems ?? [] }).map((f) => f.message));
  if (!isValid(publicationDate(d.date ?? ''))) errors.push('Enter a valid publication date.');
  if (!d.publicationSigningDate?.trim()) errors.push('Enter the planned or actual signing date.');
  errors.push(...validatePublicationDate(d.date ?? '', d.publicationSigningDate, d.publicationClosedDates).map((f) => f.message));
  errors.push(...validateMajorItemsOrder(store.publicationTables?.majorItems ?? []).map((f) => f.message));
  for (const [key, rows] of Object.entries(store.publicationTables ?? {})) {
    if (!rows.some((r) => Object.values(r.values).some((v) => v.trim()))) continue;
    const spec = tableSpec(key);
    if (!spec) { errors.push(`Unknown publication table: ${key}.`); continue; }
    const attached = store.paragraphs.filter((p) => p.tableKey === key);
    if (attached.length !== 1) errors.push(`${spec.name} must be attached to exactly one paragraph.`);
    if (spec.columns.some((c) => c.key === 'item')) errors.push(...validateItemNumbers(rows, spec.name, key === 'materielRequired').map((f) => f.message));
    if (rows.some((r) => Object.values(r.values).some((v) => v.trim()) && !r.values.description?.trim())) errors.push(`${spec.name}: every populated row needs a description.`);
  }
  if (d.fontFamily !== 'times' || d.fontSize !== '12pt') errors.push('I-Type text requires Times at 12 points.');
  if (d.signatureType !== 'digital') errors.push('Select a digital signature for the authentication page.');
  if (!/^[A-F]$/.test(d.cuiDistStatement ?? '')) errors.push('Select Distribution Statement A, B, C, D, E, or F.');
  if (d.cuiDistStatement === 'A' && !['unclassified', 'custom'].includes(deriveOverallClassLevel(d.classLevel, store.paragraphs))) errors.push('Statement A conflicts with the selected controlled or classified markings. Resolve the release determination before export.');
  if (d.cuiDistStatement === 'A' && (d.exportRestricted || d.distReason === 'Export Controlled')) errors.push('Export-controlled information cannot use Distribution Statement A.');
  if (d.distReason === 'Export Controlled' && !d.exportRestricted) errors.push('Include the export-control warning for Export Controlled information.');
  if (d.exportRestricted && (!['B', 'C', 'D', 'E'].includes(d.cuiDistStatement ?? '') || d.distReason !== 'Export Controlled')) {
    errors.push('The export-control warning requires Distribution Statement B, C, D, or E with the reason Export Controlled.');
  }
  if (deriveOverallClassLevel(d.classLevel, store.paragraphs) === 'cui') {
    if (!d.cuiControlledBy?.trim()) errors.push('Enter the organization responsible for the CUI designation.');
    if (!d.cuiCategory?.trim()) errors.push('Enter the CUI categories.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.pocEmail ?? '')) errors.push('Enter the originating office mailbox for the CUI designation block.');
  }
  errors.push(...validateDistributionFillIns(d.cuiDistStatement, { reason: d.distReason, date: d.distDate, office: d.controllingOffice }).map((f) => f.message));
  errors.push(...validateReasonForStatement(d.cuiDistStatement, d.distReason).map((f) => f.message));
  if (d.cuiDistStatement && d.cuiDistStatement !== 'A' && !isValid(parseISO(d.distDate ?? ''))) errors.push('Enter a valid distribution determination date.');
  errors.push(...validateUrgencyByType(d.publicationType, d.miUrgency).map((f) => f.message));
  if ((d.publicationType ?? 'MI') !== 'MI' && (d.miCompletionDate || store.paragraphs.some((p) => /^time compliance period\.?$/i.test(p.header ?? '')))) {
    errors.push('Only an MI may specify a Time Compliance Period. Remove the inherited period and completion date.');
  }
  errors.push(...validateTimeCompliance(d.miUrgency ?? 'normal', d.miCompletionDate, publicationDate(d.date ?? '')).map((f) => f.message));
  errors.push(...validateFigures(store.paragraphs).filter((f) => /has no/.test(f.message)).map((f) => f.message));
  errors.push(...validateProcedureSteps(store.paragraphs).map((f) => f.message));
  errors.push(...validateCalloutOrder(store.paragraphs).map((f) => f.message));
  const paragraphs = withTimeCompliance(store.paragraphs, d.miUrgency ?? 'normal', d.miCompletionDate);
  errors.push(...validatePublicationStructure(paragraphs, d.publicationType).map((f) => f.message));
  errors.push(...validatePublicationReferences(paragraphs, store.publicationTables));
  const fields = [d.shortTitle, d.pcn, d.nomenclature, d.subject, d.unitLine1, d.unitLine2, d.unitAddress,
    d.sigFirst, d.sigMiddle, d.sigLast, d.sigTitle, d.controllingOffice, d.pocEmail, d.supersedure,
    d.classifiedBy, d.derivedFrom, d.classReason, d.declassifyOn, d.customClassification];
  const content = JSON.stringify({ fields, paragraphs: paragraphs.map((p) => ({ ...p, text: p.text.replace(REFERENCE_TOKEN, ''), tableFootnotes: p.tableFootnotes?.map((n) => ({ ...n, text: n.text.replace(REFERENCE_TOKEN, '') })) })), endItems: store.endItems, tables: store.publicationTables });
  if (/\[[A-Za-z][^\]\n]{1,250}\]|\{\{[^}]+\}\}|INSERT LONG TITLE HERE/.test(content)) errors.push('Replace the remaining template prompts and variables before export.');
  return [...new Set(errors)];
}
