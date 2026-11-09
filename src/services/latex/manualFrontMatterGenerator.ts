import { emptyManualFrontMatter, manualType } from '@/data/techpub/manualFrontMatter';
import { MANUAL_DISTRIBUTION, MANUAL_DESTRUCTION } from '@/data/techpub/manualStatements';
import { publicationDate } from '@/lib/timeCompliance';
import { format, isValid, parseISO } from 'date-fns';
import { safeUrl } from '@/lib/url-safety';
import type { DocumentData } from '@/types/document';
import { escapeLatex, escapeLatexUrl } from './escaper';
import { stockDefinitionText } from './stockPublicationHelpers';

export const manualPlainText = (value: string) => stockDefinitionText(value).replaceAll('\\slThreeDefinitionWord{', '\\manualTextWord{');

/** Keep the full destination when visible link text wraps across lines. */
export function manualLinkedText(text: string): string {
  let result = '', cursor = 0;
  for (const hit of text.matchAll(/https?:\/\/[^\s<>"]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gi)) {
    let value = hit[0];
    const closing: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
    const balance: Record<string, number> = { '(': 0, '[': 0, '{': 0 };
    for (const char of value) {
      if (Object.hasOwn(balance, char)) balance[char]++;
      else if (closing[char]) balance[closing[char]]--;
    }
    let quoted = text[hit.index - 1] === "'";
    while (value) {
      const last = value.at(-1)!;
      if ('.,;'.includes(last)) { value = value.slice(0, -1); continue; }
      if (closing[last] && balance[closing[last]] < 0) { balance[closing[last]]++; value = value.slice(0, -1); continue; }
      if (last === "'" && quoted) { quoted = false; value = value.slice(0, -1); continue; }
      break;
    }
    result += manualPlainText(text.slice(cursor, hit.index));
    let uri: string | null = null;
    try { uri = safeUrl(/^https?:\/\//i.test(value) ? new URL(value).href : `mailto:${value}`); } catch { /* An incomplete draft link stays editable text. */ }
    const pieces = Array.from(value).reduce<string[]>((parts, char, index) => {
      if (index % 24 === 0) parts.push('');
      parts[parts.length - 1] += char;
      return parts;
    }, []);
    result += uri ? pieces.map(piece => `\\dondocsExternalLink{${escapeLatexUrl(uri)}}{${escapeLatex(piece)}}`).join('\\allowbreak{}') : manualPlainText(value);
    cursor = hit.index + value.length;
  }
  return result + manualPlainText(text.slice(cursor));
}

export function generateManualFrontMatterData(data: Partial<DocumentData>, referenceDate = new Date()): string {
  const m = data.manualFrontMatter ?? emptyManualFrontMatter();
  const [coverType, authenticationType] = manualType(m.subtype);
  const hasTechnicalHeading = coverType.includes('TECHNICAL MANUAL');
  const issued = publicationDate(data.date ?? '', referenceDate);
  const volume = m.volume || m.volumes ? `VOLUME ${m.volume} OF ${m.volumes}` : '';
  const isoDate = (value = '') => isValid(parseISO(value)) ? format(parseISO(value), 'd MMMM yyyy') : value;
  const statement = (MANUAL_DISTRIBUTION[data.cuiDistStatement as keyof typeof MANUAL_DISTRIBUTION] ?? '')
    .replaceAll('(category)', data.distReason ?? '').replaceAll('(date of determination)', isoDate(data.distDate))
    .replaceAll('(insert controlling DoD office)', data.controllingOffice ?? '');
  const label = (heading: string, value: string) => `\\textbf{\\uline{${escapeLatex(heading)}}}: ${manualLinkedText(value)}`;
  const notice = (value: string) => value.trim() ? `\\noindent ${manualLinkedText(value.trim())}\\par\\vspace{6bp}\n` : '';
  return [
    `\\setSubject{${manualPlainText(data.subject ?? '')}}`,
    `\\setNomenclature{${manualPlainText(data.nomenclature ?? '')}}`,
    `\\setControllingOffice{${manualPlainText(data.controllingOffice ?? '')}}`,
    `\\setPOC{${escapeLatex(data.pocEmail ?? '')}}`,
    `\\def\\ManualControlOffice{${manualPlainText([...new Set([data.cuiControlledBy, data.controllingOffice].filter(Boolean))].join(', '))}}`,
    `\\setPCN{${escapeLatex((data.pcn ?? '').replace(/\s/g, '').replace(/^(\d{3})(\d{6})(\d{2})$/, '$1 $2 $3'))}}`,
    `\\setPublicationTypeName{${escapeLatex(coverType)}}`,
    `\\def\\ManualCoverHeading{${escapeLatex(hasTechnicalHeading ? coverType : 'TECHNICAL MANUAL')}}`,
    `\\def\\ManualCoverKind{${escapeLatex(hasTechnicalHeading ? '' : coverType)}}`,
    `\\setCoverDate{${escapeLatex(isValid(issued) ? format(issued, 'MMMM yyyy').toUpperCase() : data.date ?? '')}}`,
    `\\def\\ManualAuthenticationType{${escapeLatex(authenticationType)}}`,
    `\\def\\ManualNumberPrefix{${m.subtype === 'ietm' ? 'IETM ' : ''}}`,
    `\\def\\ManualIssuer{${[data.unitLine1?.toUpperCase(), data.unitLine2, data.unitAddress].filter(Boolean).flatMap(value => (value ?? '').split(/\r?\n/)).map(manualPlainText).join('\\\\ ')}}`,
    `\\def\\ManualService{${escapeLatex(m.service)}}`,
    `\\def\\ManualVolume{${escapeLatex(volume)}}`,
    `\\def\\ManualMaintenance{${manualPlainText(m.maintenanceLevel)}}`,
    `\\def\\ManualSubtitle{${manualPlainText(m.subtitle)}}`,
    `\\def\\ManualCUIContact{${manualLinkedText(data.pocEmail ?? '')}}`,
    `\\def\\ManualContentContact{${manualLinkedText(m.contentContact.trim().replace(/\.$/, ''))}}`,
    `\\def\\ManualContractClause{${escapeLatex(m.dfarClause === 'none' ? '' : m.dfarClause)}}`,
    `\\def\\ManualPreNotices{${notice(m.supplementNotice)}${notice(m.volumeNotice)}}`,
    `\\def\\ManualPostNotices{${notice(m.copyrightCredit)}${notice(m.governmentRights)}}`,
    `\\setSupersedure{${data.supersedure?.trim() ? label('SUPERSEDURE NOTICE', data.supersedure.trim().replace(/^SUPERSEDURE NOTICE:\s*/i, '')) : ''}}`,
    `\\setDistStatementFull{${data.cuiDistStatement ? label(`DISTRIBUTION STATEMENT ${data.cuiDistStatement}`, statement) : ''}}`,
    `\\def\\ITypeDestructionNotice{${data.cuiDistStatement && data.cuiDistStatement !== 'A' ? label('DESTRUCTION NOTICE', MANUAL_DESTRUCTION.replace(/^DESTRUCTION NOTICE:\s*/, '')) : ''}}`,
    '\\RecordingInstructionfalse',
  ].join('\n') + '\n';
}
