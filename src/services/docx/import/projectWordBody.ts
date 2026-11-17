import type { ParsedLetter } from '@/lib/parseNavalLetter';
import { projectWordParagraphFields } from './projectWordParagraphFields';
import { readWordPrintedCounter } from './printedCounter';
import { projectWordLayout } from './projectWordLayout';
import type { WordBlock } from './readWord';

export type WordHeaderFields = Partial<Pick<ParsedLetter, 'from' | 'to' | 'via' | 'subject' | 'ssic' | 'serial' | 'date' | 'references' | 'enclosures' | 'signature' | 'department' | 'unitLine1' | 'unitLine2' | 'unitAddress' | 'copyTos' | 'distributions'>>;
const labels = { from: 'from', to: 'to', via: 'via', subj: 'subject', subject: 'subject' } as const;

/** Map only complete, unambiguous field paragraphs. Rich blocks and other
 * prefix prose are content even when they precede the first numbered item. */
export function projectWordBody(source: readonly WordBlock[], notice: (message: string) => void): { blocks: WordBlock[]; headerFields: WordHeaderFields } {
  const paragraphFields = projectWordParagraphFields(source, notice);
  const layoutCandidates = projectWordLayout(source, paragraphFields.trailing, notice);
  const candidates = [...layoutCandidates, ...paragraphFields.claims];
  let bodyStarted = false;
  for (const block of source) {
    if (block.numbered || /^\s*\d+\.\s+/.test(block.plainText)) bodyStarted = true;
    if (bodyStarted || block.paragraph.bodyTable || block.paragraph.figure) continue;
    const match = /^\s*(from|to|via|subj(?:ect)?)\s*:\s*([\s\S]+)$/i.exec(block.plainText);
    if (!match) continue;
    const field = labels[match[1].toLowerCase() as keyof typeof labels];
    candidates.push({ blocks: [block], fields: { [field]: match[2].trim() } });
  }
  const counts = new Map<string, number>();
  for (const candidate of candidates) for (const key of Object.keys(candidate.fields)) counts.set(key, (counts.get(key) ?? 0) + 1);
  const mapped = new Set<WordBlock>(), headerFields: WordHeaderFields = {};
  for (const candidate of candidates) {
    if (Object.keys(candidate.fields).some(key => counts.get(key) !== 1)) { notice('Repeated or ambiguous Word header/closing fields remain in the body. Review the detected letter fields.');continue; }
    Object.assign(headerFields, candidate.fields);for (const block of candidate.blocks) mapped.add(block);
  }
  if (mapped.size) notice('Recognized From, To, Via and Subject paragraphs use native letter fields. Other introductory content stays in the editable body.');
  if (layoutCandidates.some(candidate => candidate.blocks.some(block => mapped.has(block)))) notice('Recognized letterhead, identification, reference/enclosure lists and closing signature scaffolding use native fields. Review their native layout; other tables and images remain editable body content.');
  const blocks: WordBlock[] = [];
  for (const block of source) {
    if (mapped.has(block)) continue;
    if (!block.plainText.trim() && !block.paragraph.figure && !block.paragraph.bodyTable && !block.paragraph.header) {
      notice('Empty spacing paragraphs use native paragraph spacing; the original Word file retains their exact layout.'); continue;
    }
    const paragraph = { ...block.paragraph };
    let nativeTextOffset = 0;
    if (!block.numbered && !paragraph.figure && !paragraph.bodyTable && !paragraph.header) {
      const counter = readWordPrintedCounter(paragraph.text);
      if (counter) {
        nativeTextOffset = counter.visibleLength;
        paragraph.text = paragraph.text.slice(counter.serializedLength);
        paragraph.level = counter.level;
        if (counter.level >= 4) notice('Printed underlined paragraph designators become native levels 4–7; review numbering before exporting.');
      }
    }
    blocks.push({ ...block, paragraph, nativeTextOffset });
  }
  return { blocks, headerFields };
}
