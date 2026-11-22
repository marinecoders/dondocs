import { taggedReferenceUrl } from './links';
import { resolveLetterheadMode } from '@/lib/letterheadMode';
import { DOC_TYPE_CONFIG } from '@/types/document';
import { bodyTableSchema } from '@/lib/bodyTable';
import { resolveAppendedEndorsements } from '@/lib/appendedEndorsement';
import type { TaggedCorrespondenceSource } from './correspondence';

const TAGGED_LAYOUTS = {
  standard_letter: 'standard-letter',
  naval_letter: 'naval-letter',
  multiple_address_letter: 'multiple-address-letter',
} as const;

export function taggedLayout(docType: string): typeof TAGGED_LAYOUTS[keyof typeof TAGGED_LAYOUTS] | undefined {
  return Object.hasOwn(TAGGED_LAYOUTS, docType) ? TAGGED_LAYOUTS[docType as keyof typeof TAGGED_LAYOUTS] : undefined;
}

export function taggedLetterhead(source: TaggedCorrespondenceSource) {
  const layout = taggedLayout(source.docType);
  return layout && layout !== 'standard-letter'
    ? resolveLetterheadMode(DOC_TYPE_CONFIG[source.docType], source.formData) : null;
}

/** Conservative, visible support boundaries. Unsupported source stays editable;
 * a tagged request must stop rather than silently return an ordinary PDF. */
export function taggedCorrespondenceIssues(source: TaggedCorrespondenceSource, resolvedLevel = source.formData.classLevel ?? 'unclassified'): string[] {
  const issues: string[] = [];
  if (!taggedLayout(source.docType)) issues.push('Tagged PDF currently supports standard, naval and multiple-address letters. Other document layouts need separate qualification.');
  if (resolvedLevel !== 'unclassified' || source.paragraphs.some(p => (p.portionMarking && p.portionMarking !== 'U') || (p.figure?.portionMarking && p.figure.portionMarking !== 'U'))) issues.push('Classification and handling banners are not yet qualified for tagged output.');
  if (source.enclosures.length || source.formData.basicLetterFile || source.formData.basicLetterFileRef) issues.push('Tagged output cannot include original PDFs or enclosures. Export the native letter separately.');
  if (source.formData.signatureType && source.formData.signatureType !== 'none') issues.push('Signature images and digital signature fields need separate tagged-output qualification.');
  if (resolveAppendedEndorsements(source.docType, source.formData).length) issues.push('Appended endorsements are not yet qualified for tagged output.');
  const hasRecipients = source.formData.to?.trim() || source.docType === 'multiple_address_letter' && source.distributions.length;
  if (!source.formData.subject?.trim() || !source.formData.from?.trim() || !hasRecipients || !source.formData.date?.trim()) {
    issues.push(source.docType === 'multiple_address_letter'
      ? 'Complete the subject, date, From and either To or Distribution before tagged export.'
      : 'Complete the subject, date, From and To fields before tagged export.');
  }
  if (!source.paragraphs.length || source.paragraphs.length > 200) issues.push('Tagged letters require between 1 and 200 body paragraphs.');
  if (source.paragraphs.some(p => p.tableKey || p.callout || p.procedure || p.appendix)) issues.push('Publication blocks need their tagged-output qualification.');
  for (const [index, p] of source.paragraphs.entries()) {
    if (p.bodyTable) {
      const parsed = bodyTableSchema.safeParse(p.bodyTable);
      if (!parsed.success || !p.bodyTable.headerRows || p.bodyTable.headerRows >= p.bodyTable.rows.length
        || p.bodyTable.rows.slice(0, p.bodyTable.headerRows).some(row => row.some(cell => !cell.trim()))) issues.push('Tagged tables need a valid rectangular body with nonempty column headers and at least one data row.');
      if (parsed.success && p.bodyTable.rows.length > 0 && (p.bodyTable.rows[0].length > 6 || p.bodyTable.rows.some(row => row.reduce((sum, cell) => sum + cell.length, 0) > 1200 || row.some(cell => cell.length > 400)))) issues.push('Tagged tables currently support up to 6 columns, 400 characters per cell and 1200 per row. Split dense tables before tagged export.');
    }
    if (p.figure && (p.figure.placement !== 'body' || !p.figure.fileRef || !['image/png', 'image/jpeg'].includes(p.figure.type ?? '') || !p.figure.altText?.trim() || p.figure.altText.length > 2000)) issues.push('Tagged body images need an attached PNG or JPEG and meaningful alternative text.');
    if ((p.figure || p.bodyTable) && (p.level !== 0 || (source.paragraphs[index + 1]?.level ?? 0) !== 0)) issues.push('Tagged tables and images must stand between top-level paragraphs.');
  }
  if (source.paragraphs.some(p => !p.bodyTable && !p.figure && !p.text.trim() && !p.header?.trim())) issues.push('Remove empty body paragraphs before tagged export.');
  if (source.paragraphs.some((p, index) => !Number.isInteger(p.level) || p.level < 0 || p.level > 5 || (!index && p.level !== 0)
    || (index > 0 && p.level > source.paragraphs[index - 1].level + 1))) issues.push('Correct the paragraph hierarchy before tagged export.');
  if (source.formData.includeHyperlinks && source.references.some(ref => ref.url?.trim() && (!taggedReferenceUrl(ref.url) || taggedReferenceUrl(ref.url)!.length > 8192))) issues.push('Correct unsafe or excessively long reference URLs before tagged export.');
  if (source.formData.includeHyperlinks && source.references.some(ref => ref.url?.trim() && ref.title.length > 2000)) issues.push('Tagged linked reference titles must be at most 2000 characters.');
  if (source.references.some(ref => !ref.letter.trim() || !ref.title.trim())) issues.push('Complete reference labels and titles before tagged export.');
  if (source.copyTos.some(row => !row.text.trim()) || source.distributions.some(row => !row.text.trim())) issues.push('Remove empty Copy to and Distribution entries before tagged export.');
  if (source.paragraphs.filter(p => p.figure).length > (taggedLetterhead(source) === 'full' ? 19 : 20)) issues.push('Tagged output supports at most 20 painted raster images, including the naval seal.');
  const estimate = 40 + source.references.length * 4 + (source.copyTos.length + source.distributions.length) * 3 + source.paragraphs.reduce((sum, paragraph) => {
    const table = bodyTableSchema.safeParse(paragraph.bodyTable);
    return sum + (table.success ? table.data.rows.length * (table.data.rows[0].length + 1) + 3 : paragraph.figure ? 3 : 7);
  }, 0);
  if (estimate > 4000) issues.push('The document exceeds the qualified tagged structure limit. Split large tables or lists into separate documents.');
  const chars = source.paragraphs.reduce((sum, p) => sum + p.text.length + (p.header?.length ?? 0) + (bodyTableSchema.safeParse(p.bodyTable).data?.rows.reduce((total, row) => total + row.reduce((length, cell) => length + cell.length, 0), 0) ?? 0) + (p.figure?.altText?.length ?? 0), 0);
  if (chars > 250_000 || source.references.length > 100 || source.copyTos.length > 100 || source.distributions.length > 100) issues.push('The letter exceeds the qualified tagged-output content limits.');
  return issues;
}
