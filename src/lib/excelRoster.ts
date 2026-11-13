import type { CellObject } from 'xlsx';

export const ROSTER_LIMITS = { bytes: 10 * 1024 * 1024, rows: 5000, columns: 100, cells: 100_000 };

export interface RosterCell {
  value: string;
  numericIdentifierRisk?: boolean;
  warning?: string;
}
export interface ExcelRoster {
  sheetName: string;
  columnCount: number;
  rows: { number: number; cells: RosterCell[] }[];
}
export interface RosterSelection {
  roster: ExcelRoster;
  headerRow: number | null;
}
export interface RosterWarning {
  placeholder: string;
  value: string;
  message: string;
  kind?: 'ambiguous-date';
}

const ambiguousDate = (value: string) => {
  const match = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{2}|\d{4})$/.exec(value.trim());
  return !!match && +match[1] >= 1 && +match[1] <= 12 && +match[3] >= 1 && +match[3] <= 12
    && (match[1] !== match[3] || match[4].length === 2);
};
const isIdentifier = (label: string) => /(?:^|[^A-Z0-9])(?:ID|EDIPI|DODID|IDENTIFIER|SSN|MOS|ZIP|POSTAL|PHONE|SERIAL|ACCOUNT|CASE_NUM)(?:$|[^A-Z0-9])/.test(label.toUpperCase());

/** Parse locally, loading the spreadsheet codec only when a file is selected.
 * Formulae are never evaluated; only their saved results are used.
 */
export async function readExcelRoster(file: File): Promise<ExcelRoster> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose an Excel .xlsx file. Save older .xls files as .xlsx first.');
  if (file.size > ROSTER_LIMITS.bytes) throw new Error('Choose a roster smaller than 10 MB.');
  const { read, utils, SSF } = await import('xlsx');
  const bytes = new Uint8Array(await file.arrayBuffer());
  // SheetJS accepts CSV/HTML too. An .xlsx upload must actually be a ZIP.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('This file is not an Excel workbook. Save it as .xlsx and try again.');
  let workbook;
  try {
    if (bytes[2] !== 0x03 || bytes[3] !== 0x04) throw new Error('Invalid workbook ZIP header');
    workbook = read(bytes, { type: 'array', sheets: 0, sheetRows: ROSTER_LIMITS.rows + 1, cellNF: true, cellText: true, cellHTML: false });
  } catch {
    throw new Error('This workbook could not be read. Open it in Excel, remove any password, and save it as .xlsx.');
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) throw new Error('The first worksheet is empty. Put the roster on the first worksheet and try again.');
  const fullRange = utils.decode_range(sheet['!fullref'] || sheet['!ref']);
  if (fullRange.e.r >= ROSTER_LIMITS.rows || fullRange.e.c >= ROSTER_LIMITS.columns) {
    throw new Error('The first worksheet exceeds 5,000 rows or 100 columns. Split the roster into smaller files.');
  }
  const date1904 = !!workbook.Workbook?.WBProps?.date1904;
  const rows = new Map<number, RosterCell[]>();
  let columnCount = 0;
  let cellCount = 0;
  for (const [address, rawCell] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue;
    if (++cellCount > ROSTER_LIMITS.cells) throw new Error('The first worksheet exceeds 100,000 cells. Split the roster into smaller files.');
    const { r, c } = utils.decode_cell(address);
    const cell = rawCell as CellObject;
    if (cell.v == null && !cell.f) continue;
    const result: RosterCell = { value: cell.w ?? String(cell.v ?? '') };
    if (cell.t === 'e') {
      result.value = '';
      result.warning = 'Excel reports a cell error. Correct it in the workbook or enter a value below.';
    } else if (cell.f) {
      result.warning = cell.v == null
        ? 'This formula has no saved result. Recalculate and save in Excel, or enter a value below.'
        : 'This formula uses its last saved result. Check that Excel recalculated it before saving.';
    }
    if (cell.t === 'n' && typeof cell.v === 'number') {
      const format = typeof cell.z === 'string' ? cell.z : 'General';
      if (SSF.is_date(format) && /[yd]/i.test(format.replace(/"[^"]*"|\[[^\]]*\]/g, ''))) {
        const date = SSF.parse_date_code(cell.v, { date1904 });
        if (date && date.y >= 1 && date.m >= 1 && date.d >= 1 && !(date.y === 1900 && date.m === 2 && date.d === 29)) {
          const pad = (n: number) => String(n).padStart(2, '0');
          result.value = `${String(date.y).padStart(4, '0')}-${pad(date.m)}-${pad(date.d)}`;
          if (date.H || date.M || date.S) result.value += ` ${pad(date.H)}:${pad(date.M)}:${pad(date.S)}`;
        } else {
          result.warning = 'This Excel date is invalid. Check it before generating documents.';
        }
      } else if (!SSF.is_date(format)) {
        // Keep zero-padding from formats such as 000000; General numbers
        // have no evidence that any original leading zeros survived.
        result.numericIdentifierRisk = !/^0\d/.test(result.value);
        if (Number.isInteger(cell.v) && (!Number.isSafeInteger(cell.v) || String(Math.abs(cell.v)).length > 15)) {
          result.warning = 'Excel may have rounded this number. Verify long identifiers against the original source.';
        }
      }
    }
    if (ambiguousDate(result.value)) result.warning = 'Ambiguous date. Confirm day/month order and use YYYY-MM-DD or a month name.';
    const row = rows.get(r + 1) ?? [];
    row[c] = result;
    rows.set(r + 1, row);
    columnCount = Math.max(columnCount, c + 1);
  }
  const populated = [...rows.entries()].sort(([a], [b]) => a - b)
    .filter(([, cells]) => cells.some(cell => cell.value.trim() || cell.warning))
    .map(([number, cells]) => ({ number, cells: Array.from({ length: columnCount }, (_, i) => cells[i] ?? { value: '' }) }));
  if (!populated.length) throw new Error('The first worksheet is empty. Put the roster on the first worksheet and try again.');
  return { sheetName, columnCount, rows: populated };
}

export function rosterDataRows({ roster, headerRow }: RosterSelection) {
  return roster.rows.filter(row => headerRow === null || row.number > headerRow);
}

export function rosterHeaders({ roster, headerRow }: RosterSelection) {
  const header = roster.rows.find(row => row.number === headerRow);
  return Array.from({ length: roster.columnCount }, (_, i) => header?.cells[i]?.value.trim() || `Column ${i + 1}`);
}

/** Only exact, unique names are safe to map automatically. */
export function autoMapRosterColumns(headers: string[], placeholders: string[]) {
  const normalize = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '_');
  const normalized = headers.map(normalize);
  return Object.fromEntries(normalized.flatMap((header, i) => {
    const matches = placeholders.filter(p => normalize(p) === header);
    return matches.length === 1 && normalized.filter(h => h === header).length === 1 ? [[i, matches[0]]] : [];
  }));
}

export function mappedRosterRows(selection: RosterSelection, mappings: Record<number, string>, placeholders: string[]) {
  const headers = rosterHeaders(selection);
  return rosterDataRows(selection).map(row => {
    const values: Record<string, string> = Object.create(null);
    const warnings: RosterWarning[] = [];
    for (const [index, placeholder] of Object.entries(mappings)) {
      if (!placeholder || !placeholders.includes(placeholder)) continue;
      const cell = row.cells[+index];
      const value = cell?.value.trim() ?? '';
      values[placeholder] = value;
      const location = `Worksheet row ${row.number}, ${placeholder}`;
      if (cell?.warning) warnings.push({ placeholder, value, message: `${location}: ${cell.warning}`, ...(ambiguousDate(value) ? { kind: 'ambiguous-date' as const } : {}) });
      if (cell?.numericIdentifierRisk && (isIdentifier(headers[+index]) || isIdentifier(placeholder))) {
        warnings.push({ placeholder, value, message: `${location}: Stored as a number; leading zeros may already be missing. Verify against the original source.` });
      }
    }
    return { values, warnings, worksheetRow: row.number };
  });
}

export function rosterRowWarnings(row: { values: Record<string, string>; rosterWarnings?: RosterWarning[]; worksheetRow?: number }, placeholders: string[]) {
  if (row.worksheetRow === undefined) return [];
  return [
    ...(row.rosterWarnings ?? []).filter(warning => warning.kind !== 'ambiguous-date' && placeholders.includes(warning.placeholder) && row.values[warning.placeholder] === warning.value),
    ...placeholders.flatMap(placeholder => {
      const value = row.values[placeholder] ?? '';
      const location = `Worksheet row ${row.worksheetRow}, ${placeholder}`;
      if (!value.trim()) return [{ placeholder, value: '', message: `${location}: Missing value. Enter it below or remove this row.` }];
      if (ambiguousDate(value)) return [{ placeholder, value, message: `${location}: Ambiguous date. Confirm day/month order and use YYYY-MM-DD or a month name.` }];
      return [];
    }),
  ];
}
