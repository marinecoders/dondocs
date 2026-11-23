import { directiveDesignation, directiveHasCancellation, directiveReference, isDirective } from '@/lib/directiveFormats';
import type { DocumentData } from '@/types/document';

type Escape = (value: string) => string;

export function directiveLayout(docType: string, data: Partial<DocumentData>, escape: Escape) {
  if (!isDirective(docType)) return undefined;
  return {
    reference: escape(directiveReference(docType, data)),
    cancellation: directiveHasCancellation(docType) ? escape(data.directiveCancellation?.trim() ?? '') : '',
    designation: escape(directiveDesignation(docType, data)),
    reports: docType === 'marine_corps_order' || docType === 'marine_corps_bulletin'
      ? (data.directiveReports ?? '').split('\n').map(line => line.trim()).filter(Boolean).map(escape).join('\\newline ')
      : '',
  };
}
