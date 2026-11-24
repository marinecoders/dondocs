import type { DocumentData, Enclosure, Paragraph } from '@/types/document';
import { deriveOverallClassLevel } from '@/lib/overallClassification';
import { enclosureMarkingLevel } from '@/lib/enclosureMarkings';
import { unfilled } from '@/lib/requiredField';
import { normalizeDate } from '@/lib/dateFormatting';
import { composeSenderSymbol } from '@/services/latex/senderSymbol';
import { textWidthMilliEm } from '@/services/latex/subparagraphIndent';
import { splitAddressForLetterhead } from '@/lib/unitAddress';

export type WindowEnvelopeLayout = 'standard' | 'salutation' | 'subject';
export const WINDOW_ENVELOPE_PITCH = 12;
export const WINDOW_ENVELOPE_ADDRESS_WIDTH = 234; // One-inch left margin to the middle of US Letter.

export function windowEnvelopeLayout(docType: string, data: Partial<DocumentData>): WindowEnvelopeLayout | undefined {
  const mode = data.windowEnvelope;
  if (docType === 'naval_letter' && mode === 'standard') return mode;
  if (docType === 'business_letter' && (mode === 'salutation' || mode === 'subject')) return mode;
}

export function windowEnvelopeAddress(value = ''): string[] {
  return value.split(/\r\n?|[\n\u2028\u2029]/).map(line => line.trim()).filter(Boolean);
}

function heading(mode: WindowEnvelopeLayout, data: Partial<DocumentData>): string {
  if (mode === 'salutation') return data.salutation?.trim() ?? '';
  const subject = data.subject?.trim().toUpperCase() ?? '';
  return subject && `${mode === 'standard' ? 'Subj:' : 'SUBJECT:'}  ${subject}`;
}

function senderDate(mode: WindowEnvelopeLayout, date: string): string | null {
  return normalizeDate(date, mode === 'standard' ? 'military' : 'spelled');
}

function senderSymbols(mode: WindowEnvelopeLayout, data: Partial<DocumentData>): string[] {
  const date = data.date ?? '';
  return [data.ssic ?? '', composeSenderSymbol(data.officeCode, data.serial), senderDate(mode, date) ?? date];
}

export function windowEnvelopeProblems(docType: string, data: Partial<DocumentData>, paragraphs: Paragraph[], enclosures: Enclosure[]): string[] {
  const mode = windowEnvelopeLayout(docType, data);
  if (!mode) return [];
  const address = windowEnvelopeAddress(data.to);
  const issues: string[] = [];
  const font = data.fontFamily === 'courier' ? 'courier' : 'times';
  const size = Number.parseInt(data.fontSize ?? '12', 10) || 12;
  const measured = (value: string) => textWidthMilliEm(value, font) * size / 1000;
  const singleLine = (value: string) => !/[\r\n\u2028\u2029]/.test(value);
  if (![10, 11, 12].includes(size)) issues.push('Use a 10, 11 or 12 point font for the window-envelope layout.');
  if (data.letterheadMode === 'title-only' || data.letterheadMode !== 'preprinted' && unfilled(data.unitLine1)) {
    issues.push('Use complete or approved preprinted letterhead for a window-envelope letter.');
  }
  if (data.letterheadMode !== 'preprinted') {
    const { line1, line2 } = splitAddressForLetterhead(data.unitAddress ?? '');
    if ([data.unitLine1 ?? '', data.unitLine2 ?? '', line1, line2].some(line => !singleLine(line) || textWidthMilliEm(line, font) * 8 / 1000 > 282)) {
      issues.push('Shorten the printed letterhead lines to fit above the mailing address.');
    }
  }
  if (deriveOverallClassLevel(data.classLevel ?? 'unclassified', paragraphs) !== 'unclassified' || data.cuiTransmittalNote
    || enclosures.some(({ marking }) => marking && enclosureMarkingLevel(marking) !== 'unclassified')) {
    issues.push('Window envelopes require an unclassified letter and unclassified enclosures without handling restrictions.');
  }
  if (mode === 'standard' && data.via?.trim()) issues.push('Remove Via routing before exporting a standard window-envelope letter.');
  if (!address.length || unfilled(data.to)) issues.push('Enter the complete mailing address.');
  if (address.length > 5) issues.push('The mailing address must use five lines or fewer.');
  if (address.some(line => measured(line) > WINDOW_ENVELOPE_ADDRESS_WIDTH - 3)) issues.push('Shorten address lines that extend past the middle of the page.');
  if (unfilled(mode === 'salutation' ? data.salutation : data.subject)) issues.push(`Enter the ${mode === 'salutation' ? 'salutation' : 'subject'}.`);
  const title = heading(mode, data);
  if (measured(title) > 465 || !singleLine(title)) issues.push('Use a single-line salutation or subject for the window-envelope layout.');
  if (data.date?.trim() && senderDate(mode, data.date) === null) {
    issues.push('Enter a valid date. Use a four-digit year for a business letter.');
  }
  if (senderSymbols(mode, data).some(line => measured(line) > 465 || !singleLine(line))) issues.push('Keep each sender symbol on one line.');
  return issues;
}

export interface WindowEnvelopeRow {
  /** Fixed slot position in points from the top of US Letter. */
  top: number;
  text: string;
  indent?: number;
  kind: 'symbol' | 'address' | 'heading';
  field: 'ssic' | 'senderSymbol' | 'date' | 'to' | 'salutation' | 'subject';
}

export function windowEnvelopeRows(mode: WindowEnvelopeLayout, data: Partial<DocumentData>): WindowEnvelopeRow[] {
  const standard = mode === 'standard';
  const symbols = senderSymbols(mode, data);
  const font = data.fontFamily === 'courier' ? 'courier' : 'times';
  const size = Number.parseInt(data.fontSize ?? '12', 10) || 12;
  const symbolWidth = Math.ceil(Math.max(...symbols.map(text => textWidthMilliEm(text, font))) * size / 1000);
  const indent = Math.max(0, 465 - symbolWidth);
  const symbolFields = ['ssic', 'senderSymbol', 'date'] as const;
  return [
    ...symbolFields.map((field, index): WindowEnvelopeRow => ({ top: (standard ? 132 : 120) + index * WINDOW_ENVELOPE_PITCH, text: symbols[index], kind: 'symbol', field, indent })),
    ...windowEnvelopeAddress(data.to).slice(0, 5).map((text, index): WindowEnvelopeRow => ({ top: (standard ? 192 : 180) + index * WINDOW_ENVELOPE_PITCH, text, kind: 'address', field: 'to' })),
    { top: 288, text: heading(mode, data), kind: 'heading', field: mode === 'salutation' ? 'salutation' : 'subject' },
  ];
}

export const WINDOW_ENVELOPE_MAILING_NOTICE = 'Confirm the letter and all enclosures are unclassified. Use a regular envelope for national-security or personal material, correspondence to high-level officials, or FOUO. Print at actual size and check that the complete address stays visible when folded and shifted in the window.';
export const WINDOW_ENVELOPE_WORD_REVIEW_LIMIT = 'Word review returns do not support window-envelope opening fields. Use a DonDocs review copy for this saved revision.';
