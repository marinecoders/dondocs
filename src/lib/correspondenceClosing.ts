import type { Paragraph } from '@/types/document';
import { isTechnicalPublication } from './publicationPreflight';

export function hasBottomSignature(type: string): boolean {
  return !isTechnicalPublication(type) && type !== 'action_memorandum' && type !== 'information_memorandum';
}

/** Link two written paragraphs so a one-line closing retains preceding prose. */
export function closingTailStart(type: string, paragraphs: Paragraph[]): number | undefined {
  if (!hasBottomSignature(type)) return undefined;
  return paragraphs.flatMap((paragraph, i) => paragraph.text.trim() ? [i] : []).slice(-2)[0];
}
