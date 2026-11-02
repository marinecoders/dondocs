import { iTypeExportErrors } from './iTypePreflight';
import { sl3ExportErrors } from './sl3Preflight';
import { sl4ExportErrors } from './sl4Preflight';

export const isTechnicalPublication = (docType: string): boolean =>
  docType === 'i_type' || docType === 'sl3' || docType === 'sl4';
export function publicationExportErrors(
  store: Parameters<typeof iTypeExportErrors>[0],
): string[] {
  if (store.docType === 'sl4') return sl4ExportErrors(store);
  return store.docType === 'sl3'
    ? sl3ExportErrors(store)
    : iTypeExportErrors(store);
}
