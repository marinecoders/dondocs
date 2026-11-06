import { format, isValid, parse } from 'date-fns';
import { composeDistributionStatement } from '@/data/techpub/distributionStatements';
import type { DocumentData } from '@/types/document';

/** Expand the editor's letter using the same wording as publication covers.
 * Preserve full statement text from older drafts and companion callers. */
export function documentDistributionStatement(data: Partial<DocumentData>): string {
  const selected = data.cuiDistStatement?.trim() || '';
  if (!/^[A-F]$/i.test(selected)) return selected;
  const determined = parse(data.distDate || '', 'yyyy-MM-dd', new Date());
  return composeDistributionStatement(selected, {
    reason: data.distReason,
    date: isValid(determined) ? format(determined, 'd MMMM yyyy') : '',
    office: data.controllingOffice,
  });
}
