import { normalizeDate } from '@/lib/dateFormatting';
import type { DocumentData } from '@/types/document';
import { composeSenderSymbol } from './senderSymbol';

/** The same identification lines appear on the opening and continuation pages. */
export function businessLetterIdentification(data: Partial<DocumentData>) {
  const date = data.date?.trim() ?? '';
  return {
    ssic: data.ssic?.trim() ?? '',
    sender: composeSenderSymbol(data.officeCode, data.serial),
    date: normalizeDate(date, 'spelled') ?? date,
  };
}

export function businessLetterClosing(data: Partial<DocumentData>, enclosureCount: number) {
  return {
    label: enclosureCount === 1 ? 'Enclosure' : 'Enclosures',
    countOnly: data.businessEnclosuresCountOnly === true,
    separateMailing: data.businessSeparateMailing?.trim().replace(/\s+/g, ' ') ?? '',
  };
}

export function businessLetterContinuation(docType: string, data: Partial<DocumentData>): string[] {
  return docType === 'business_letter' ? Object.values(businessLetterIdentification(data)).filter(Boolean) : [];
}
