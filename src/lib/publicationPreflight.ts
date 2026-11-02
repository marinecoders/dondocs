import { iTypeExportErrors } from './iTypePreflight';
import { sl3ExportErrors } from './sl3Preflight';

export const isTechnicalPublication = (docType: string): boolean =>
  docType === 'i_type' || docType === 'sl3';
export function publicationExportErrors(
  store: Parameters<typeof iTypeExportErrors>[0],
): string[] {
  return store.docType === 'sl3'
    ? sl3ExportErrors(store)
    : iTypeExportErrors(store);
}
