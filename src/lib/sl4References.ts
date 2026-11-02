import { numberedSl4Parts, SL4_NSN_PATTERN, type Sl4Data } from '@/data/techpub/sl4';
import { sl4HierarchyFindings } from './sl4Validation';

const key = (value: string) => value.trim().toUpperCase();
const compare = (a: string, b: string) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
const nsnKey = (nsn: string) => nsn.trim().replaceAll('-', '');

/**
 * Source preface paragraphs 15–18. Derive every index from Part I, retaining
 * repeated occurrences and stable row IDs so reordering cannot leave stale links.
 * Alphanumeric keys use deterministic lexical order; leading zeros are retained.
 */
export function buildSl4Indexes(data: Sl4Data) {
  const parts = numberedSl4Parts(data.rows);
  const hierarchy = sl4HierarchyFindings(data.rows);
  if (hierarchy.some((finding) => finding.code === 'duplicate-row'))
    throw new Error('SL-4 row IDs must be unique before building cross-references.');
  if (hierarchy.length) throw new Error('Correct the SL-4 hierarchy before building cross-references.');
  if (parts.some((part) => part.nsn.trim() && !SL4_NSN_PATTERN.test(part.nsn.trim())))
    throw new Error('Correct the invalid NSN before building cross-references.');
  if (data.circuitIndex.mode === 'include') {
    const symbols = parts.flatMap((part) => part.circuitSymbols.map(key));
    if (symbols.some((symbol) => !symbol) || new Set(symbols).size !== symbols.length)
      throw new Error('Correct the empty or ambiguous circuit symbols before building cross-references.');
  }
  const records = parts.map((part) => ({
    rowId: part.id,
    itemNumber: part.itemNumber,
    nsn: part.nsn.trim(),
    partNumber: part.partNumber.trim(),
    cage: part.cage.trim(),
    portionMarking: part.portionMarking,
  }));
  const byCageAndItem = (a: typeof records[number], b: typeof records[number]) =>
    compare(a.cage, b.cage) || a.itemNumber - b.itemNumber;
  return {
    partII: records.filter((row) => !row.nsn),
    partIII: records.filter((row) => row.nsn).sort((a, b) =>
      compare(nsnKey(a.nsn), nsnKey(b.nsn)) || byCageAndItem(a, b)),
    partIV: records.filter((row) => row.partNumber).sort((a, b) =>
      compare(a.partNumber, b.partNumber) || byCageAndItem(a, b)),
    partV: data.circuitIndex.mode !== 'include' ? [] : parts.flatMap((part) =>
      part.circuitSymbols.map((circuitSymbol) => ({
        circuitSymbol: circuitSymbol.trim(),
        rowId: part.id,
        itemNumber: part.itemNumber,
        portionMarking: part.portionMarking,
      }))).sort((a, b) => compare(a.circuitSymbol, b.circuitSymbol) || a.itemNumber - b.itemNumber),
  };
}

/** Read down each source panel before continuing at the top of the next panel. */
export function sl4IndexPanels<T>(records: readonly T[], rowsPerPanel: number, panels: 2 | 3): T[][][] {
  if (!Number.isInteger(rowsPerPanel) || rowsPerPanel < 1)
    throw new Error('Cross-reference panel capacity must be a positive integer.');
  if (panels !== 2 && panels !== 3)
    throw new Error('SL-4 cross-references use two or three panels.');
  const pages: T[][][] = [];
  for (let start = 0; start < records.length; start += rowsPerPanel * panels) {
    pages.push(Array.from({ length: panels }, (_, panel) =>
      records.slice(start + panel * rowsPerPanel, start + (panel + 1) * rowsPerPanel)));
  }
  return pages;
}
