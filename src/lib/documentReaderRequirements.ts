import type { DocumentData, Enclosure } from '@/types/document';
import { requiresEnclosureMarkingReader } from './enclosureMarkings';

interface ReaderSource {
  docType?: string;
  formData?: Pick<Partial<DocumentData>, 'cuiTransmittalNote'> & { volume?: unknown };
  enclosures?: readonly Pick<Enclosure, 'marking'>[];
  paragraphs?: readonly unknown[];
}
const TABLE_LAYOUT_FIELDS = ['columnWidths', 'columnAlignments', 'borders', 'fontSize', 'minimumRowHeight', 'repeatHeaders'] as const;

/** Require the same reader for retained data even after switching document type. */
export function requiresCurrentDocumentReader(source: ReaderSource): boolean {
  if (requiresEnclosureMarkingReader(source) || source.docType === 'technical_volume' || source.formData?.volume !== undefined) return true;
  return !!source.paragraphs?.some(paragraph => {
    if (!paragraph || typeof paragraph !== 'object') return false;
    if ('volumeSectionId' in paragraph && paragraph.volumeSectionId !== undefined) return true;
    if (!('bodyTable' in paragraph) || !paragraph.bodyTable || typeof paragraph.bodyTable !== 'object') return false;
    const table = paragraph.bodyTable as Record<string, unknown>;
    return TABLE_LAYOUT_FIELDS.some(key => Object.hasOwn(table, key) && table[key] !== undefined);
  });
}
