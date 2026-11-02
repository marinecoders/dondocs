import { sl4Schema, sl4Portions, sl4FigureIds } from '@/data/techpub/sl4';
import { isSl4BlockingFinding, sl4ContentFindings } from './sl4Validation';
import { stockPublicationErrors, type StockPublicationStore } from './stockPublicationPreflight';
import { validateFigures } from './figures';
import { SL4_ABBREVIATIONS } from '@/data/techpub/sl4Definitions';
import { parse, isValid, format } from 'date-fns';

export function sl4ExportErrors(store: StockPublicationStore): string[] {
  if (store.docType !== 'sl4') return [];
  const parsed = sl4Schema.safeParse(store.formData.sl4 ?? {});
  if (!parsed.success) return ['The SL-4 parts data is invalid. Restore a valid draft before export.'];
  const data = parsed.data;
  const figures = store.paragraphs.filter((p) => p.figure);
  const errors = stockPublicationErrors({ ...store, paragraphs: figures }, 'sl4', sl4Portions(data, figures));
  const publicationDate = parse(store.formData.date ?? '', 'd MMM yy', new Date());
  if (isValid(publicationDate) && data.cutoffDate > format(publicationDate, 'yyyy-MM-dd')) errors.push('Publication cut-off date cannot follow the effective publication date.');
  for (const finding of sl4ContentFindings(data, { figureIds: figures.map((p) => p.referenceId ?? '') }))
    if (isSl4BlockingFinding(finding))
      errors.push(`${finding.path.join('.')}: ${finding.message}`);
  const used = sl4FigureIds(data);
  const endItem = figures.find((p) => p.referenceId === data.endItemFigureId);
  if (endItem && endItem.text.trim().toUpperCase().replace(/\s+/g, ' ') !== store.formData.nomenclature?.trim().toUpperCase().replace(/\s+/g, ' '))
    errors.push('End item illustration title must match the end item nomenclature.');
  if (figures.some((p) => !p.referenceId || !used.includes(p.referenceId))) errors.push('Assign every illustration to the end item or a repair part.');
  for (const id of used) {
    const review = data.artwork.find((artwork) => artwork.figureId === id);
    if (!review) errors.push('Review the lettering in every illustration before export.');
    else if (review.lettering === 'labels' && (!review.labels.length || review.labels.some((label) => !label.text.trim() || /[\r\n]/.test(label.text))))
      errors.push('Provide every illustration label as complete, single-line searchable text.');
    else if (review.lettering === 'none' && review.labels.length) errors.push('Choose searchable labels for an illustration with labels.');
    if (review && new Set(review.labels.map((label) => label.id)).size !== review.labels.length) errors.push('Illustration label IDs must be unique.');
  }
  if (new Set(data.artwork.map((artwork) => artwork.figureId)).size !== data.artwork.length) errors.push('Each illustration must have only one lettering review.');
  const terms = new Set<string>(SL4_ABBREVIATIONS.map(([term]) => term.trim().toUpperCase()));
  for (const definition of data.definitions) {
    const term = definition.term.trim().toUpperCase();
    if (!term || !definition.meaning.trim() || terms.has(term)) errors.push('Complete every definition and use unique terms.');
    terms.add(term);
  }
  errors.push(...validateFigures(figures).filter((finding) => /has no/.test(finding.message)).map((finding) => finding.message));
  return [...new Set(errors)];
}

export const SL4_SECTION_IDS = ['sl4-cover', 'classification', 'sl4-preface', 'sl4-cages', 'sl4-parts', 'sl4-figures', 'sl4-indexes', 'sl4-revisions', 'signature'];
export function sl4ErrorSection(message: string): string {
  if (/^(Signatory|Signing authority|Select a digital signature|SL-4 authentication)/i.test(message)) return 'signature';
  if (/^(rows|The SL-4 parts)/.test(message)) return /illustration/i.test(message) ? 'sl4-figures' : 'sl4-parts';
  if (/^cages|CAGE/.test(message)) return 'sl4-cages';
  if (/^revisions/.test(message)) return 'sl4-revisions';
  if (/^circuitIndex/.test(message)) return 'sl4-indexes';
  if (/illustration|^Figure|^artwork|endItemFigureId|lettering/i.test(message)) return 'sl4-figures';
  if (/^(Short title|PCN|Long title|End item nomenclature|Issuing command|Command line 2|Command address|Controlling office|Program office email|Supersedure notice)/i.test(message)) return 'sl4-cover';
  if (/source technical|maintenance technical|standalone|cut-off|notes|definition|template prompt/i.test(message)) return 'sl4-preface';
  if (/classif|marking|Distribution Statement|designation|control warning|Export-controlled/i.test(message)) return 'classification';
  return 'sl4-cover';
}
