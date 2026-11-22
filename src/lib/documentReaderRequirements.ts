import type { DocumentData, Enclosure } from '@/types/document';
import { requiresEnclosureMarkingReader } from './enclosureMarkings';

interface ReaderSource {
  docType?: string;
  formData?: Pick<Partial<DocumentData>, 'cuiTransmittalNote'> & { volume?: unknown; jointAdditionalCommands?: unknown; letterheadMode?: unknown; stationerySize?: unknown };
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

/** Each shipped renderer capability owns distinct portable reader revisions. */
export const CORRESPONDENCE_READERS = {
  joint: { draft: 6, share: 9, assets: 10, backup: 18 },
  letterhead: { draft: 7, share: 11, assets: 12, backup: 19 },
} as const;

export function correspondenceReaderRequirement(source: ReaderSource) {
  const data = source.formData;
  if (data?.letterheadMode === 'title-only' || data?.letterheadMode === 'preprinted') return CORRESPONDENCE_READERS.letterhead;
  if (Array.isArray(data?.jointAdditionalCommands) && data.jointAdditionalCommands.length > 0) return CORRESPONDENCE_READERS.joint;
  return undefined;
}

/** Retained inactive fields still need a reader that can preserve their meaning. */
export function requiresExtendedCorrespondenceReader(source: ReaderSource): boolean {
  return correspondenceReaderRequirement(source) !== undefined;
}
