import { isValid, parse } from 'date-fns';
import type { DocumentData, Paragraph } from '@/types/document';
import { deriveOverallClassLevel } from './overallClassification';

export function iTypeClassificationErrors(data: Partial<DocumentData>, paragraphs: Paragraph[]): string[] {
  const level = deriveOverallClassLevel(data.classLevel, paragraphs);
  if (!['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(level)) return [];
  const errors: string[] = [];
  if (!['original', 'derivative'].includes(data.classificationBasis ?? '')) errors.push('Select original or derivative classification.');
  if (!data.classifiedBy?.trim()) errors.push('Enter the classifier name and position or identifier, including the originating office.');
  if (data.classificationBasis === 'derivative' && !data.derivedFrom?.trim()) errors.push('Identify the source of derivative classification.');
  if (data.classificationBasis === 'original' && !data.classReason?.trim()) errors.push('Enter the original classification reason.');
  const declassification = data.declassifyOn?.trim() ?? '';
  if (!declassification) errors.push('Enter the declassification date or authorized instruction.');
  else if (/^\d[\d/ -]*$/.test(declassification) && (!/^\d{8}$/.test(declassification) || !isValid(parse(declassification, 'yyyyMMdd', new Date())))) {
    errors.push('Use a valid YYYYMMDD declassification date.');
  }
  const content = paragraphs.filter((p) => p.header?.trim() || p.text.trim() || p.tableKey || p.figure);
  if (content.some((p) => !p.portionMarking)) errors.push('Mark every classified-publication paragraph, heading, table and caption with its portion classification.');
  if (content.some((p) => p.figure && !p.figure.portionMarking)) errors.push('Mark each graphic separately from its caption.');
  return errors;
}
