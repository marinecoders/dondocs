import { referenceLetterIndex } from '@/lib/referenceLetters';
import type { WordBlock } from './readWord';
import type { WordHeaderFields } from './projectWordBody';

export interface WordFieldClaim { blocks: WordBlock[]; fields: WordHeaderFields }
const tailLabel = /^(copy\s*to|distribution)\s*:\s*([\s\S]*)$/i;
const date = /^(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/;
const plain = (block: WordBlock) => !block.paragraph.figure && !block.paragraph.bodyTable && !block.paragraph.header;
const bodyStart = (block: WordBlock) => plain(block) && (block.numbered || /^\s*\d+\.\s+/.test(block.plainText));

/** A second printed item inside one value needs a deliberate review instead
 * of silently turning the rest of the list into one reference title. */
export function wordListItem(value: string, index: number, references: boolean): string | null {
  const match = /^\(([a-z0-9]+)\)\s+([\s\S]+)$/i.exec(value);
  if (!match || (references ? referenceLetterIndex(match[1]) !== index : match[1] !== String(index + 1))
      || /\s+\([a-z\d]+\)\s+/i.test(match[2])) return null;
  return match[2].replace(/\s+/g, ' ').trim() || null;
}

/** Whole source blocks are claimed together. A partial/ambiguous field never
 * enters both native metadata and the editable body. */
export function projectWordParagraphFields(source: readonly WordBlock[], notice: (text: string) => void) {
  const claims: WordFieldClaim[] = [], trailing = new Set<WordBlock>();
  const firstBody = source.findIndex(bodyStart), limit = firstBody < 0 ? source.length : firstBody;
  const firstHeader = source.findIndex((block, i) => i < limit && (/^\s*(?:from|to|subj(?:ect)?)\s*:/i.test(block.plainText)
    || block.tablePlainRows?.some(row => /^from:$/i.test(row[0].trim()))));
  for (let i = 0; i < limit; i++) {
    const block = source[i], text = block.plainText.trim();
    if (!plain(block)) continue;
    if (firstHeader >= 0 && i < firstHeader) {
      if (/^\d{4,5}(?:\.\d+)?$/.test(text)) claims.push({ blocks: [block], fields: { ssic: text } });
      else if (/^Ser\s+\S/i.test(text)) claims.push({ blocks: [block], fields: { serial: text.replace(/^Ser\s+/i, '') } });
      else if (date.test(text)) claims.push({ blocks: [block], fields: { date: text } });
    }
    const label = /^(ref(?:erence)?|encl(?:osure)?)\s*:\s*([\s\S]*)$/i.exec(text);
    if (!label) continue;
    const references = /^ref/i.test(label[1]), items: string[] = [], blocks = [block];
    const item = (value: string) => {
      const text = wordListItem(value, items.length, references);
      if (text === null) return false;
      items.push(text);return true;
    };
    let valid = !label[2] || item(label[2]);
    for (let next = i + 1; valid && next < limit; next++) {
      const candidate = source[next];
      if (!plain(candidate) || !/^\([a-z\d]+\)\s+/i.test(candidate.plainText.trim())) break;
      valid = item(candidate.plainText.trim());blocks.push(candidate);
    }
    if (valid && items.length) claims.push({ blocks, fields: { [references ? 'references' : 'enclosures']: items } });
    else notice('An incomplete or ambiguous Word reference/enclosure list stays in the body and does not populate native list fields.');
  }
  const lastBody = source.reduce((last, block, i) => bodyStart(block) ? i : last, -1);
  for (let i = lastBody + 1; lastBody >= 0 && i < source.length; i++) {
    const block = source[i];
    if (!plain(block)) continue;
    const label = tailLabel.exec(block.plainText.trim());
    if (!label) continue;
    const blocks = [block], recipients: string[] = [];
    const add = (text: string) => {
      const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
      if (lines.some(line => line.length > 500 || /[.!?]$/.test(line) || tailLabel.test(line) || /^(?:[a-z]\.|\d+\.|\([a-z\d]+\))\s+/i.test(line) || /^\s*(?:from|to|subj|ref|encl)\s*:/i.test(line))) return false;
      recipients.push(...lines);return true;
    };
    let valid = add(label[2]);
    for (let next = i + 1; valid && next < source.length; next++) {
      const candidate = source[next], text = candidate.plainText.trim();
      if (!plain(candidate) || !text || tailLabel.test(text) || bodyStart(candidate)) break;
      valid = add(text);blocks.push(candidate);
    }
    if (valid && recipients.length) {
      claims.push({ blocks, fields: { [/^copy/i.test(label[1]) ? 'copyTos' : 'distributions']: recipients } });
      for (const member of blocks) trailing.add(member);
    } else notice('An ambiguous trailing Word list stays in the body; review its label and recipients before moving it into native fields.');
  }
  return { claims, trailing };
}
