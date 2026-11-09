import { parse, isValid, parseISO } from 'date-fns';
import type { DocumentData, EndItem, Paragraph } from '@/types/document';
import { iTypeClassificationErrors } from './iTypeClassification';
import { validateDistributionFillIns, validateReasonForStatement } from './classificationValidation';
import { validatePublicationDate } from './publicationDate';
import { validateIdentifiers } from './identifiers';
import { unfilled } from './requiredField';
import { deriveOverallClassLevel } from './overallClassification';
import { stockPublicationPrompt } from './stockPublicationText';

export interface StockPublicationStore {
  docType: string;
  formData: Partial<DocumentData>;
  paragraphs: Paragraph[];
  endItems?: EndItem[];
}

/** Common stock-list metadata, marking, date and authentication requirements. */
export function stockPublicationErrors(store: StockPublicationStore, kind: 'sl3' | 'sl4', portions: Paragraph[], referenceDate = new Date()): string[] {
  const errors: string[] = [];
  const d = store.formData;
  for (const [key, label] of Object.entries({
    shortTitle: 'Short title', pcn: 'PCN', subject: 'Long title', nomenclature: 'End item nomenclature',
    unitLine1: 'Issuing command', unitLine2: 'Command line 2', unitAddress: 'Command address',
    sigFirst: 'Signatory first name', sigMiddle: 'Signatory middle name', sigLast: 'Signatory last name',
    sigTitle: 'Signing authority title', controllingOffice: 'Controlling office',
    pocEmail: 'Program office email', supersedure: 'Supersedure notice',
  })) {
    if (stockPublicationPrompt(String(d[key as keyof DocumentData] ?? '')))
      errors.push(`${label}: replace the remaining template prompt before export.`);
  }
  store.paragraphs.filter((paragraph) => paragraph.figure).forEach((figure, i) => {
    if (stockPublicationPrompt(figure.text))
      errors.push(`Figure ${i + 1}: replace the remaining template prompt in its title before export.`);
  });
  for (const [key, label] of Object.entries({
    shortTitle: 'Short title',
    pcn: 'PCN',
    nomenclature: 'End item nomenclature',
    subject: 'Long title',
    unitLine1: 'Issuing command',
    unitAddress: 'Command address',
    sigTitle: 'Signing authority title',
    sigLast: 'Signatory',
    controllingOffice: 'Controlling office',
    pocEmail: 'Program office email',
  })) {
    if (unfilled(String(d[key as keyof DocumentData] ?? '')))
      errors.push(`${label} is required.`);
  }
  if (
    d.shortTitle &&
    !new RegExp(`^SL-${kind === 'sl4' ? '4' : '3'}[- ]\\d{4,5}[A-HJ-NP-Z]?(?:[-/][A-Z0-9]+)*$`, 'i').test(
      d.shortTitle.trim(),
    )
  )
    errors.push('Enter the assigned SL-3 short title, as SL-3-12345A.');
  errors.push(
    ...validateIdentifiers({
      pcn: d.pcn,
      endItems: store.endItems ?? [],
      majorItems: [],
      allowTamcnBase: true,
    }).map((f) => f.message),
  );
  if (!isValid(parse(d.date?.trim() ?? '', 'd MMM yy', referenceDate)))
    errors.push('Enter a valid publication date.');
  if (
    d.cuiDistStatement &&
    d.cuiDistStatement !== 'A' &&
    !isValid(parseISO(d.distDate ?? ''))
  )
    errors.push('Enter a valid distribution determination date.');
  if (d.pocEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.pocEmail))
    errors.push('Enter a valid program office email.');
  errors.push(
    ...validatePublicationDate(
      d.date ?? '',
      d.publicationSigningDate,
      d.publicationClosedDates,
      referenceDate,
    ).map((f) => f.message),
  );
  if (!d.publicationSigningDate)
    errors.push('Enter the planned or actual signing date.');
  if (d.fontFamily !== 'times' || d.fontSize !== '10pt')
    errors.push(
      kind === 'sl4'
        ? 'SL-4 requires Times-compatible text at the template sizes (10-point preface, 9-point parts, 8-point indexes).'
        : 'SL-3 requires Times-compatible text at the template sizes (10-point preface, 9-point inventory).',
    );
  if (d.signatureType !== 'digital')
    errors.push('Select a digital signature for SL-3 authentication.');
  if (d.byDirection || /\bby\s+direction\b/i.test(d.sigTitle ?? ''))
    errors.push(
      'SL-3 authentication cannot be signed by direction (MCO 5215.17D, paragraph 4.b(4)(f)).',
    );
  errors.push(
    ...iTypeClassificationErrors(d, [
      ...store.paragraphs,
      ...portions,
    ]).map((error) => error.replaceAll('I-Type', 'SL-3')),
  );
  if (!/^[A-F]$/.test(d.cuiDistStatement ?? ''))
    errors.push('Select Distribution Statement A, B, C, D, E or F.');
  errors.push(
    ...validateDistributionFillIns(d.cuiDistStatement, {
      reason: d.distReason,
      date: d.distDate,
      office: d.controllingOffice,
    }).map((f) => f.message),
  );
  errors.push(
    ...validateReasonForStatement(d.cuiDistStatement, d.distReason).map(
      (f) => f.message,
    ),
  );
  const level = deriveOverallClassLevel(d.classLevel, [
    ...store.paragraphs,
    ...portions,
  ]);
  if (level !== deriveOverallClassLevel(d.classLevel, store.paragraphs))
    errors.push(
      'Set the document classification to cover the highest component, note or technical-data marking.',
    );
  if (
    d.cuiDistStatement === 'A' &&
    (!['unclassified', 'custom'].includes(level) || d.exportRestricted)
  )
    errors.push(
      'Distribution Statement A conflicts with the selected control markings.',
    );
  if (d.distReason === 'Export Controlled' && !d.exportRestricted)
    errors.push(
      'Include the export-control warning for Export Controlled information.',
    );
  if (
    d.exportRestricted &&
    (!['B', 'C', 'D', 'E'].includes(d.cuiDistStatement ?? '') ||
      d.distReason !== 'Export Controlled')
  )
    errors.push(
      'Export-controlled information requires Statement B, C, D or E with the reason Export Controlled.',
    );
  if (
    level === 'cui' &&
    (!d.cuiControlledBy?.trim() ||
      !d.cuiCategory?.trim() ||
      !d.pocEmail?.trim())
  )
    errors.push('Complete the CUI designation block.');
  if (!store.endItems?.length) errors.push('Add at least one end item.');
  if (
    store.endItems?.some(
      (item) => !Object.values(item).some((value) => value.trim()),
    )
  )
    errors.push('Complete or remove empty end item entries.');
  return errors.map((message) => kind === 'sl4' ? message.replaceAll('SL-3', 'SL-4') : message);
}
