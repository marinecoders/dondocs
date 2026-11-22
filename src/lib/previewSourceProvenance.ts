import type { DocumentData, Paragraph } from '@/types/document';
import { resolveAppendedEndorsements } from './appendedEndorsement';
import { normalizePreviewText } from './previewSources';

/** Endorsement prose is independently editable even when it repeats the letter. */
export function ambiguousEndorsementBodySources(docType: string, formData: Partial<DocumentData>, paragraphs: readonly Paragraph[]): ReadonlySet<string> {
  const competing = resolveAppendedEndorsements(docType, formData)
    .flatMap(endorsement => endorsement.paragraphs.map(normalizePreviewText));
  if (!competing.length) return new Set<string>();
  return new Set(paragraphs.flatMap(paragraph => {
    const key = normalizePreviewText(paragraph.text);
    return paragraph.id && key && competing.some(text => text.includes(key)) ? [paragraph.id] : [];
  }));
}
