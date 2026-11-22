import { iTypeExportErrors } from './iTypePreflight';
import { manualFrontMatterErrors } from './manualFrontMatterValidation';
import { sl3ExportErrors } from './sl3Preflight';
import { sl4ExportErrors } from './sl4Preflight';
import { publicationVolumeErrors } from './publicationVolume';
import { deriveOverallClassLevel } from './overallClassification';
import { volumeOutputTextErrors } from './volumeOutput';
import { DOC_TYPE_CONFIG } from '@/types/document';

export const isTechnicalPublication = (docType: string): boolean =>
  Object.hasOwn(DOC_TYPE_CONFIG, docType) && DOC_TYPE_CONFIG[docType].publication === true;
export function publicationExportErrors(
  store: Parameters<typeof iTypeExportErrors>[0],
  referenceDate = new Date(),
  target: 'pdf' | 'docx' = 'pdf',
): string[] {
  if (store.docType === 'technical_volume') {
    const errors = publicationVolumeErrors(store.formData.volume, store.paragraphs);
    if (target === 'pdf') errors.push(...volumeOutputTextErrors(store));
    if (!store.formData.subject?.trim()) errors.push('Enter the volume title.');
    const level = deriveOverallClassLevel(store.formData.classLevel, store.paragraphs);
    if (!['unclassified', 'cui'].includes(level)) errors.push('Technical volumes currently support unclassified and CUI output. Classified and custom volume markings are not qualified.');
    if (level === 'cui') {
      if (!store.formData.cuiControlledBy?.trim()) errors.push('Enter the organization responsible for the CUI designation.');
      if (!store.formData.cuiCategory?.trim()) errors.push('Enter the CUI categories.');
      if (!store.formData.pocEmail?.trim()) errors.push('Enter the CUI point of contact.');
    }
    if (store.formData.signatureType && store.formData.signatureType !== 'none') errors.push('Technical volumes use the external signing handoff after export. Select no embedded signature.');
    return errors;
  }
  if (store.docType === 'tm_ietm_front_matter') return manualFrontMatterErrors(store, referenceDate);
  if (store.docType === 'sl4') return sl4ExportErrors(store, referenceDate);
  return store.docType === 'sl3'
    ? sl3ExportErrors(store, referenceDate)
    : iTypeExportErrors(store, referenceDate);
}
