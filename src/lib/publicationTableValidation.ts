import type { PublicationTableRow } from '@/types/document';
import { REFERENCE_TOKEN } from './publicationReferences';
import { tableSpec } from '@/data/techpub/tables';

const MATERIEL = ['materielRequired', 'materielDiscarded', 'materielRetained', 'materielBulk'];

export function validatePublicationTableRows(key: string, rows: PublicationTableRow[], identifierMode?: 'stock' | 'software'): string[] {
  const errors: string[] = [];
  const name = tableSpec(key)?.name ?? key;
  rows.forEach((row, index) => {
    const cell = (column: string) => (row.values[column] ?? '').replace(REFERENCE_TOKEN, '').trim();
    if (!Object.values(row.values).some((value) => value.trim()) || /^(consisting of|includes):?$/i.test(cell('description'))) return;
    const prefix = `${name}, row ${index + 1}:`;
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
