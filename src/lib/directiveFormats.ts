import type { DocumentData, DocumentMode } from '@/types/document';
import { normalizeDate } from './dateFormatting';
import { classificationBannerLevel } from './detectClassification';
import { unfilled } from './requiredField';

const DIRECTIVES = {
  marine_corps_order: { designation: 'MARINE CORPS ORDER', abbreviation: 'MCO' },
  marine_corps_bulletin: { designation: 'MARINE CORPS BULLETIN', abbreviation: 'MCBul' },
  secnav_instruction: { designation: 'SECNAV INSTRUCTION', abbreviation: 'SECNAVINST' },
  secnav_notice: { designation: 'SECNAV NOTICE', abbreviation: 'SECNAVNOTE' },
  change_transmittal: { designation: '', abbreviation: '' },
} as const;
type DirectiveType = keyof typeof DIRECTIVES;
export const DIRECTIVE_TYPES = Object.keys(DIRECTIVES) as DirectiveType[];

export function isDirective(type: string): type is DirectiveType {
  return Object.hasOwn(DIRECTIVES, type);
}

export function isMarineDirective(type: string): boolean {
  return type === 'marine_corps_order' || type === 'marine_corps_bulletin';
}

export function isSecnavDirective(type: string): boolean {
  return isDirective(type) && !isMarineDirective(type);
}

export const SECNAV_DIRECTIVE_PAGE_LIMIT = 5;

export function directiveHasCancellation(type: string): boolean {
  return type === 'marine_corps_bulletin' || type === 'secnav_notice';
}

function directiveIdentifier(type: DirectiveType, input?: string): string {
  const id = (input ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  if (type === 'change_transmittal') return id.replace(/\s+(?:CH-?\s*\d+|CHANGE TRANSMITTAL\s+\d+)$/, '');
  const { abbreviation, designation } = DIRECTIVES[type];
  for (const prefix of [abbreviation.toUpperCase(), designation]) {
    if (id === prefix) return '';
    if (id.startsWith(prefix + ' ')) return id.slice(prefix.length + 1);
  }
  return id;
}

export function directiveChangeNumber(input?: string): string {
  const value = (input ?? '').trim();
  return /^(?:0*[1-9]\d*)$/.test(value) ? value.replace(/^0+/, '') : '';
}

function directiveMarking(data: Partial<DocumentData>) {
  return data.classLevel === 'custom' ? classificationBannerLevel(data.customClassification ?? '') : data.classLevel;
}

export function directiveAuthorityRows(data: Partial<DocumentData>): Array<[string, string]> {
  if (!['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(directiveMarking(data) ?? '')) return [];
  const rows: Array<[string, string | undefined]> = [
    ['Classified by:', data.classifiedBy],
    data.classificationBasis === 'original' ? ['Reason:', data.classReason] : ['Derived from:', data.derivedFrom],
    ['Declassify on:', data.declassifyOn],
    ['POC:', data.classifiedPocEmail],
  ];
  return rows.filter((entry): entry is [string, string] => !unfilled(entry[1]));
}

export function directiveAuthorityIssues(data: Partial<DocumentData>): string[] {
  if (!['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(directiveMarking(data) ?? '')) return [];
  const issues: string[] = [];
  if (data.classificationBasis !== 'original' && data.classificationBasis !== 'derivative') {
    issues.push('Select the classification basis.');
  }
  if (unfilled(data.classifiedBy)) issues.push('Enter the classification authority.');
  if (data.classificationBasis === 'original' && unfilled(data.classReason)) issues.push('Enter the original classification reason.');
  if (data.classificationBasis === 'derivative' && unfilled(data.derivedFrom)) issues.push('Enter the derivative classification source.');
  const declassifyOn = data.declassifyOn?.trim() ?? '';
  if (unfilled(declassifyOn)) issues.push('Enter the declassification instruction.');
  else if (/^\d{8}$/.test(declassifyOn)) {
    const year = Number(declassifyOn.slice(0, 4));
    const month = Number(declassifyOn.slice(4, 6));
    const day = Number(declassifyOn.slice(6));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
      issues.push('Enter a valid declassification date.');
    }
  } else if (/^[\d/.-]+$/.test(declassifyOn) || normalizeDate(declassifyOn, 'military')) {
    issues.push('Enter the declassification date in YYYYMMDD format.');
  }
  return issues;
}

function issuedIdentifier(type: DirectiveType, data: Partial<DocumentData>): string {
  const identifier = directiveIdentifier(type, data.directiveNumber);
  if (!identifier || (type !== 'secnav_instruction' && type !== 'secnav_notice')) return identifier;
  const level = directiveMarking(data);
  const prefix = level === 'confidential' ? 'C' : level === 'secret' ? 'S' : '';
  return prefix ? prefix + identifier.replace(/^[CS]\s*(?=\d)/, '') : identifier;
}

export function directiveDesignation(type: DirectiveType, data: Partial<DocumentData>): string {
  const identifier = issuedIdentifier(type, data);
  if (type === 'change_transmittal') {
    const parent = identifier.replace(/^SECNAVINST\b/, 'SECNAV INSTRUCTION').replace(/^SECNAVNOTE\b/, 'SECNAV NOTICE');
    return [parent, 'CHANGE TRANSMITTAL', directiveChangeNumber(data.directiveChangeNumber)].filter(Boolean).join(' ');
  }
  return [DIRECTIVES[type].designation, identifier].filter(Boolean).join(' ');
}

export function directiveReference(type: DirectiveType, data: Partial<DocumentData>): string {
  const id = issuedIdentifier(type, data);
  if (!id) return '';
  if (type === 'change_transmittal') {
    const changeNumber = directiveChangeNumber(data.directiveChangeNumber);
    const parent = id.replace(/^SECNAV INSTRUCTION\b/, 'SECNAVINST')
      .replace(/^SECNAV NOTICE\b/, 'SECNAVNOTE').replace(/^(SECNAVNOTE \S+) OF .+$/, '$1');
    return parent + (changeNumber ? ' CH-' + changeNumber : '');
  }
  return DIRECTIVES[type].abbreviation + ' ' + id;
}

export function directiveContinuation(type: string, data: Partial<DocumentData>) {
  if (!isDirective(type)) return undefined;
  const reference = directiveReference(type, data);
  if (!reference) return undefined;
  const date = data.date?.trim();
  return {
    lines: date ? [reference, date] : [reference],
    alternate: isMarineDirective(type) && ['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(directiveMarking(data) ?? ''),
  };
}

export function directiveFont(type: string, mode: DocumentMode | undefined, data: Partial<DocumentData>): Partial<DocumentData> {
  if (!isDirective(type) || mode === 'custom') return data;
  return { ...data, fontFamily: 'courier', fontSize: isMarineDirective(type) && data.fontSize === '10pt' ? '10pt' : '12pt' };
}

export function directiveFormatting(type: string, mode: DocumentMode | undefined, data: Partial<DocumentData>): Partial<DocumentData> {
  const formatted = directiveFont(type, mode, data);
  if (!isSecnavDirective(type) || mode === 'custom' || data.letterheadMode === 'preprinted') return formatted;
  return { ...formatted, letterheadMode: 'full', department: 'navy', unitLine1: 'OFFICE OF THE SECRETARY',
    unitLine2: '', unitAddress: '1000 NAVY PENTAGON, WASHINGTON, DC 20350',
  };
}

export function directiveIssues(type: string, data: Partial<DocumentData>): string[] {
  if (!isDirective(type)) return [];
  const issues: string[] = [];
  const identifier = directiveIdentifier(type, data.directiveNumber);
  if (unfilled(identifier)) issues.push('Enter the directive identifier.');
  else if (type === 'secnav_notice' && !/^[CS]?\d{4,5}$/.test(identifier)) {
    issues.push('Enter the SECNAV Notice subject code without a consecutive number or revision suffix.');
  }
  if (type === 'change_transmittal' && !directiveChangeNumber(data.directiveChangeNumber)) issues.push('Enter a positive whole change number.');
  if (directiveHasCancellation(type) && unfilled(data.directiveCancellation)) issues.push('Enter the cancellation line.');
  if (unfilled(data.officeCode)) issues.push('Enter the sponsor or originating office code.');
  if (!isMarineDirective(type) && ['top_secret', 'top_secret_sci'].includes(directiveMarking(data) ?? '')) {
    issues.push('The SECNAV directives system excludes Top Secret material.');
  }
  return issues;
}

export function directiveDateInvalid(value?: string): boolean {
  return !normalizeDate(value ?? '', 'military');
}

export function directiveAddressIssues(data: Partial<DocumentData>): string[] {
  const issues: string[] = [];
  if (directiveDateInvalid(data.date)) issues.push('Enter a valid directive issue date.');
  if (unfilled(data.from)) issues.push('Enter the directive issuing authority.');
  if (unfilled(data.subject)) issues.push('Enter the directive subject.');
  return issues;
}
