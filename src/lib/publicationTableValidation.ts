import type { Paragraph, PublicationTableRow } from '@/types/document';
import { REFERENCE_TOKEN } from './publicationReferences';
import { tableSpec } from '@/data/techpub/tables';
import { publicationSection } from '@/data/techpub/sections';

const MATERIEL = ['materielRequired', 'materielDiscarded', 'materielRetained', 'materielBulk'];

export const hasPublicationTableContent = (row: PublicationTableRow): boolean =>
  Object.values(row.values).some((value) => !!value.trim()) || !!row.identificationException?.trim() || !!row.openPurchase;

/** MIL-DTL-28999D §§3.3.2.7–3.3.2.10: item sections use their prescribed tables. */
export function validatePublicationTableAttachments(
  paragraphs: Paragraph[], tables: Record<string, PublicationTableRow[]> = {},
): string[] {
  const errors: string[] = [];
  let inAppendix = false;
  paragraphs.forEach((paragraph, index) => {
    if (paragraph.appendix) inAppendix = true;
    if (inAppendix || paragraph.callout || paragraph.figure || paragraph.procedure) return;
    const section = publicationSection(paragraph);
    const spec = section ? tableSpec(section) : undefined;
    if (!spec) return;
    const rows = tables[spec.key] ?? [];
    const next = paragraphs.findIndex((p, i) => i > index && (p.appendix || (!p.callout && !p.figure && !p.procedure && (p.level <= paragraph.level || publicationSection(p)))));
    const sectionParagraphs = paragraphs.slice(index, next < 0 ? paragraphs.length : next);
    const hasProse = sectionParagraphs.some((p) => {
      if (p.callout || p.figure || p.procedure) return false;
      const text = p.text.replace(/\*\*|__|\*/g, '').trim();
      return !!text && !/^(?:none|n\/a|not applicable)\.?$/i.test(text);
    });
    // An omitted/empty section or an explicit non-applicability statement
    // does not invent a requirement for items that the instruction omits.
    const hasRows = rows.some(hasPublicationTableContent);
    const hasAttachedRows = (tables[paragraph.tableKey ?? ''] ?? []).some(hasPublicationTableContent);
    if (!hasProse && !hasRows && !hasAttachedRows) return;
    const prefix = `Paragraph ${index + 1} (${spec.name}):`;
    if (paragraph.tableKey !== spec.key) {
      errors.push(`${prefix} attach the ${spec.name} table using + table in Paragraphs, then enter item rows in Tables.`);
    } else if (!rows.some((row) => hasPublicationTableContent(row) && !/^(consisting of|includes):?$/i.test((row.values.description ?? '').trim()))) {
      errors.push(`${prefix} add at least one item row in Tables, or remove the section or enter None if it does not apply.`);
    }
  });
  return errors;
}

export function validatePublicationTableRows(key: string, rows: PublicationTableRow[], identifierMode?: 'stock' | 'software'): string[] {
  const errors: string[] = [];
  const name = tableSpec(key)?.name ?? key;
  rows.forEach((row, index) => {
    const cell = (column: string) => (row.values[column] ?? '').replace(REFERENCE_TOKEN, '').trim();
    if (!hasPublicationTableContent(row) || /^(consisting of|includes):?$/i.test(cell('description'))) return;
    const prefix = `${name}, row ${index + 1}:`;
    if (!cell('description')) errors.push(`${prefix} enter the item description.`);
    const nsn = cell('nsn'), pn = cell('pn');
    if (identifierMode === 'software') {
      if (!cell('softwareVersion')) errors.push(`${prefix} enter the current software/firmware version.`);
      if (nsn || pn || row.identificationException?.trim()) errors.push(`${prefix} the software/firmware alternative is for items without assigned NSN, PN or CAGE; clear those fields or select stock identifiers.`);
    } else if (cell('softwareVersion')) errors.push(`${prefix} select the software/firmware identifier mode to print this version.`);
    if (nsn && !/^(\d{13}|\d{4}-\d{2}-\d{3}-\d{4})$/.test(nsn)) errors.push(`${prefix} enter a thirteen-digit NSN.`);
    if (MATERIEL.includes(key) && !cell('qty')) errors.push(`${prefix} enter the quantity.`);
    if (identifierMode !== 'software' && (MATERIEL.includes(key) || key === 'specialTools')) {
      const exception = row.identificationException?.trim();
      if (exception && (key !== 'materielRequired' || nsn || pn)) errors.push(`${prefix} last-resort identification applies only to required materiel without assigned NSN, PN or CAGE.`);
      if (!(key === 'materielRequired' && exception && !nsn && !pn)) {
        if (!pn) errors.push(`${prefix} enter the part number${key === 'materielRequired' ? ' or document the last-resort identification exception' : ''}.`);
        else if (!nsn && !/^.*\S\s+\([A-Z0-9]{5}\)$/i.test(pn)) errors.push(`${prefix} include the five-character CAGE after the part number, as ABC123 (1AB23), when no NSN is assigned.`);
      }
    }
    if (row.openPurchase && (key !== 'specialTools' || !row.openPurchase.manufacturer.trim() || !row.openPurchase.address.trim())) {
      errors.push(`${prefix} open-purchase special tools require the complete manufacturer name and address.`);
    }
  });
  return errors;
}
