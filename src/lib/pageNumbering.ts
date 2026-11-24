import { isDirective } from './directiveFormats';
import type { DocumentMode } from '@/types/document';

const SECNAV_LETTERS = new Set([
  'naval_letter', 'standard_letter', 'business_letter', 'same_page_endorsement', 'new_page_endorsement',
]);

export function usesSecnavLetterNumbering(docType: string): boolean {
  return SECNAV_LETTERS.has(docType) || isDirective(docType);
}

/** Chapter 7 ¶17, Figure 9-2, and Chapter 11 ¶15: plain continuation numbers.
 * Custom documents retain their explicitly selected numbering style. */
export function resolvePageNumbering(docType: string, mode: DocumentMode | undefined, selected?: string): string {
  return mode === 'compliant' && usesSecnavLetterNumbering(docType) ? 'simple' : selected || 'none';
}
