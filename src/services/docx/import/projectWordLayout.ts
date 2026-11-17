import { wordListItem } from './projectWordParagraphFields';
import type { WordBlock } from './readWord';
import type { WordFieldClaim } from './projectWordParagraphFields';
import type { WordHeaderFields } from './projectWordBody';

const fieldNames = { 'from:': 'from', 'to:': 'to', 'via:': 'via', 'subj:': 'subject', 'subject:': 'subject' } as const;
const departments: Record<string, string> = { 'UNITED STATES MARINE CORPS': 'usmc', 'DEPARTMENT OF THE NAVY': 'navy', 'UNITED STATES NAVY': 'navy', 'DEPARTMENT OF DEFENSE': 'dod' };
const signature = /^([A-Z])\.\s*(?:([A-Z])\.\s*)?([A-Z][A-Za-z']+)$/;
const date = /^(?:\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/;

/** Recognize complete letter scaffolding by its visible content and position.
 * No producer property or editable Word identifier grants authority here.
 * Every unrecognized/partly recognized table remains editable body content. */
export function projectWordLayout(source: readonly WordBlock[], trailing: ReadonlySet<WordBlock>, notice: (text: string) => void) {
  const candidates: WordFieldClaim[] = [];
  const claim = (block: WordBlock, fields: WordHeaderFields) => candidates.push({ blocks: [block], fields });
  const firstBody = source.findIndex(block => !block.paragraph.figure && !block.paragraph.bodyTable && (block.numbered || /^\s*\d+\.\s+/.test(block.plainText)));
  const limit = firstBody < 0 ? source.length : firstBody;
  const addressingIndex = source.findIndex((block, index) => index < limit && block.tablePlainRows?.every(row => row.length === 2)
    && ['from:', 'to:', 'subj:'].every(label => block.tablePlainRows!.some(row => row[0].trim().toLowerCase().replace('subject:', 'subj:') === label)));
  const meaningful = source.filter(block => block.plainText.trim() || block.paragraph.figure);
  for (const [index, block] of source.entries()) {
    const rows = block.tablePlainRows;
    if (index >= limit || !rows) continue;
    const values = rows.map(row => row.map(cell => cell.trim()));
    if (values.every(row => row.length === 2)) {
      const nonempty = values.filter(row => row.some(Boolean));
      const keys = nonempty.map(row => fieldNames[row[0].toLowerCase() as keyof typeof fieldNames]);
      if (keys.includes('from') && keys.includes('to') && keys.includes('subject') && keys.every(Boolean) && new Set(keys).size === keys.length && nonempty.every(row => row[1])) {
        const fields: WordHeaderFields = {};
        for (const [i, row] of nonempty.entries()) fields[keys[i]] = row[1];
        claim(block, fields);continue;
      }
      const firstLabel = nonempty[0]?.[0].toLowerCase();
      if (addressingIndex >= 0 && index > addressingIndex && (firstLabel === 'ref:' || firstLabel === 'encl:') && nonempty.slice(1).every(row => !row[0])) {
        const items = nonempty.map(row => row[1]);
        const references = firstLabel === 'ref:';
        const titles = items.map((text, i) => wordListItem(text, i, references));
        if (titles.every((title): title is string => title !== null)) {
          claim(block, { [references ? 'references' : 'enclosures']: titles });
          continue;
        }
        notice('An incomplete or ambiguous Word reference/enclosure table stays in the body and does not populate native list fields.');
      }
      if (addressingIndex >= 0 && index < addressingIndex && nonempty.length >= 1 && nonempty.length <= 3 && nonempty.every(row => !row[0])) {
        const identification: WordHeaderFields = {};
        const valid = nonempty.every(([, value]) => {
          if (/^\d{4,5}(?:\.\d+)?$/.test(value) && identification.ssic === undefined) identification.ssic = value;
          else if (/^Ser\s+\S/i.test(value) && identification.serial === undefined) identification.serial = value.replace(/^Ser\s+/i, '');
          else if (date.test(value) && identification.date === undefined) identification.date = value;
          else return false;
          return true;
        });
        if (valid) { claim(block, identification);continue; }
      }
    }
    if (addressingIndex >= 0 && block === meaningful[0] && values.length === 1 && values[0].length === 3 && !values[0][0] && !values[0][2]) {
      const lines = values[0][1].split('\n').map(line => line.trim()).filter(Boolean);
      if (Object.hasOwn(departments, lines[0] ?? '') && lines.length >= 2 && lines.length <= 6) {
        claim(block, { department: departments[lines[0]], unitLine1: lines[1], unitLine2: lines.length >= 4 ? lines[2] : '', unitAddress: lines.slice(lines.length >= 4 ? 3 : 2).join(', ') });
      }
    }
  }
  const last = meaningful.filter(block => !trailing.has(block)).at(-1);
  if (last && firstBody >= 0 && source.indexOf(last) > firstBody) {
    const rows = last.tablePlainRows;
    const value = rows?.length === 1 && rows[0].length === 2 && !rows[0][0].trim() ? rows[0][1].trim() : !last.paragraph.figure && !last.paragraph.bodyTable ? last.plainText.trim() : '';
    const match = signature.exec(value);
    if (match) claim(last, { signature: { first: match[1], middle: match[2] ?? '', last: match[3] } });
  }
  return candidates;
}
