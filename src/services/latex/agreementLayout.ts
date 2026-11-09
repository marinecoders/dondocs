import type { Paragraph } from '@/types/document';
import { outlineParagraphs } from './paragraphLabel';

/** Only untouched editor rows count as spacing. Keep headings and metadata. */
export function emptyAgreementRow(para: Readonly<Paragraph>): boolean {
  return !para.text.trim() && !para.header?.trim()
    && Object.entries(para).every(([key, value]) => ['text', 'header', 'level'].includes(key) || value === undefined);
}

/** Both renderers number the same closing rows; the draft remains unchanged. */
export function agreementParagraphs(paragraphs: readonly Paragraph[]): Paragraph[] {
  const written = paragraphs.flatMap((para, i) => emptyAgreementRow(para) ? [] : [i]);
  const tailStart = written.slice(-2)[0];
  if (tailStart === undefined) return [...paragraphs];
  const retained = new Set(written);
  const outline = outlineParagraphs(paragraphs.map(para => para.level));
  for (const index of written) {
    let parent = outline[index].parentIndex;
    while (parent !== null && !retained.has(parent)) {
      retained.add(parent);
      parent = outline[parent].parentIndex;
    }
  }
  return paragraphs.filter((_para, i) => i <= tailStart || retained.has(i));
}
