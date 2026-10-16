import { deriveOverallClassLevel } from './overallClassification';
import type { DocumentData, Paragraph } from '@/types/document';
import type { ClassificationInfo } from '@/services/pdf/mergeEnclosures';

function getClassificationInfo(
  classLevel: string | undefined,
  customClassification?: string
): ClassificationInfo | undefined {
  if (!classLevel || classLevel === 'unclassified') {
    return undefined;
  }

  // Handle custom classification
  if (classLevel === 'custom' && customClassification) {
    return { level: classLevel, marking: customClassification };
  }

  const markingMap: Record<string, string> = {
    cui: 'CUI',
    confidential: 'CONFIDENTIAL',
    secret: 'SECRET',
    top_secret: 'TOP SECRET',
    top_secret_sci: 'TOP SECRET//SCI',
  };

  const marking = markingMap[classLevel];
  if (!marking) return undefined;

  return { level: classLevel, marking };
}


export function publicationMarking(data: Partial<DocumentData>, paragraphs: Paragraph[]): ClassificationInfo | undefined {
  return getClassificationInfo(deriveOverallClassLevel(data.classLevel, paragraphs), data.customClassification);
}
