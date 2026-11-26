import { isStaffPaper } from './staffPapers';
import type { Paragraph } from '@/types/document';
import { isTechnicalPublication } from './publicationPreflight';

export function hasBottomSignature(type: string): boolean {
  return !isStaffPaper(type) && !isTechnicalPublication(type) && type !== 'action_memorandum' && type !== 'information_memorandum';
}

/** Trim unused editor rows only at the end of correspondence output. */
export function printableCorrespondenceParagraphs(paragraphs: Paragraph[], previewHintIndex = -1): Paragraph[] {
  let end = paragraphs.length;
  while (end > previewHintIndex + 1) {
    const p = paragraphs[end - 1];
    if (p.text.trim() || p.header?.trim() || p.bodyTable || p.figure || p.portionMarking ||
        p.referenceId || p.publicationSection || p.volumeSectionId || p.tableKey ||
        p.tableFootnotes?.length || p.callout || p.procedure || p.appendix) break;
    end--;
  }
  return end === paragraphs.length ? paragraphs : paragraphs.slice(0, end);
}

/** Link two written paragraphs so a one-line closing retains preceding prose. */
export function closingTailStart(type: string, paragraphs: Paragraph[]): number | undefined {
  if (!hasBottomSignature(type)) return undefined;
  return paragraphs.flatMap((paragraph, i) => paragraph.text.trim() ? [i] : []).slice(-2)[0];
}
