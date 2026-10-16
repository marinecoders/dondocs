import { REFERENCE_TOKEN } from './publicationReferences';
import type { EndItem, PublicationTableRow } from '@/types/document';

/**
 * The shapes a technical publication's identifiers take, read off the
 * template's own masks and examples and MCO 5215.17D:
 *
 *   PCN          ### ###### ##   eleven digits: a three-digit prefix, the
 *                                 ID/SSIC/FSC and an internal digit, then the
 *                                 basic/change designator
 *   Short title  XI xxxxxX-xx/X   the type, the ID number, the year, a sequence
 *   TAMCN        A02557G          seven positions: commodity, item, class
 *   I.D. No.     11031A           five digits and a letter
 *
 * Each is advisory: a drafter with an odd but real number keeps it.
 */

export interface IdentifierFinding {
  severity: 'warning';
  message: string;
}

const PCN = /^\d{3} ?\d{6} ?\d{2}$/;
const SHORT_TITLE = /^(MI|SI|TI|LI) (?:\d{5}[A-HJ-NP-Z]?|\d{4})-\d{2}\/\d+$/;
const TAMCN = /^[A-Z]\d{5}[A-Z]$/;
const ID_NO = /^\d{5}[A-HJ-NP-Z]$/;
const NSN = /^(\d{4}-\d{2}-\d{3}-\d{4}|\d{13})$/;

const warn = (message: string): IdentifierFinding => ({ severity: 'warning', message });

export function validateIdentifiers(input: {
  pcn?: string;
  shortTitle?: string;
  publicationType?: string;
  endItems: EndItem[];
  majorItems: PublicationTableRow[];
}): IdentifierFinding[] {
  const findings: IdentifierFinding[] = [];
  const pcn = (input.pcn ?? '').trim();
  if (pcn && !PCN.test(pcn)) findings.push(warn('A PCN is eleven digits, as 184 123456 00.'));

  const title = (input.shortTitle ?? '').trim();
  if (title) {
    if (!SHORT_TITLE.test(title)) {
      findings.push(warn('Use the publication type, assigned ID/FSC/SSIC basic number, year and sequence, as MI 12345A-24/1. ID suffixes exclude I and O.'));
    } else if (input.publicationType && !title.startsWith(`${input.publicationType} `)) {
      findings.push(warn(`The short title names a ${title.slice(0, 2)} but the publication type is ${input.publicationType}.`));
    }
  }

  const items = [
    ...input.endItems.map((e) => ({ nsn: e.nsn, tamcn: e.tamcn, id: e.id })),
    ...input.majorItems.map((r) => ({ nsn: (r.values.nsn ?? '').replace(REFERENCE_TOKEN, ''), tamcn: (r.values.tamcn ?? '').replace(REFERENCE_TOKEN, ''), id: (r.values.id ?? '').replace(REFERENCE_TOKEN, '') })),
  ];
  const bad = (key: 'nsn' | 'tamcn' | 'id', re: RegExp) =>
    items.map((i) => i[key].trim()).filter((v) => v && !re.test(v));
  const nsn = bad('nsn', NSN);
  if (nsn.length) findings.push(warn(`An NSN is thirteen digits, as 5895-01-520-4360: ${nsn.join(', ')}.`));
  const tamcn = bad('tamcn', TAMCN);
  if (tamcn.length) findings.push(warn(`A TAMCN is seven positions, as A02557G: ${tamcn.join(', ')}.`));
  const id = bad('id', ID_NO);
  if (id.length) findings.push(warn(`An I.D. number is five digits and a letter other than I or O, as 11031A: ${id.join(', ')}.`));
  return findings;
}
