import { describe, expect, it } from 'vitest';
import { utils } from 'xlsx';
import { readExcelRoster, rosterHeaders, rosterDataRows, autoMapRosterColumns, mappedRosterRows, rosterRowWarnings, ROSTER_LIMITS } from '@/lib/excelRoster';
import { rosterFile } from '../_helpers/excelRosterFixture';

describe('Excel roster import', () => {
  it('reads only the first worksheet and preserves row numbers, sparse columns, text and displayed zero-padding', async () => {
    const sheet = utils.aoa_to_sheet([['Example roster'], [], ['NAME', 'MOS', 'CODE', 'NOTE'], ['Recipient A', '0012', 42], [], ['Recipient B', '', '', 'End']]);
    sheet.C4.z = '000000';
    const roster = await readExcelRoster(rosterFile([], { sheet, secondSheet: [['Other'], ['Ignore me']] }));
    expect(roster.sheetName).toBe('Roster');
    expect(roster.rows.map(row => row.number)).toEqual([1, 3, 4, 6]);
    const selection = { roster, headerRow: 3 };
    expect(rosterHeaders(selection)).toEqual(['NAME', 'MOS', 'CODE', 'NOTE']);
    expect(rosterDataRows(selection).map(row => row.cells.map(cell => cell.value))).toEqual([
      ['Recipient A', '0012', '000042', ''], ['Recipient B', '', '', 'End'],
    ]);
    expect(rosterHeaders({ roster, headerRow: null })).toEqual(['Column 1', 'Column 2', 'Column 3', 'Column 4']);
    expect(rosterDataRows({ roster, headerRow: null })).toHaveLength(4);
  });

  it.each([false, true])('normalizes real Excel dates and times without a timezone shift (1904=%s)', async date1904 => {
    const sheet = utils.aoa_to_sheet([['DATE', 'DATETIME', 'TIME'], [1, 1.75, 0.5]]);
    sheet.A2.z = 'm/d/yy';sheet.B2.z = 'yyyy-mm-dd hh:mm:ss';sheet.C2.z = 'hh:mm';
    const roster = await readExcelRoster(rosterFile([], { sheet, date1904 }));
    expect(roster.rows[1].cells.map(cell => cell.value)).toEqual(date1904
      ? ['1904-01-02', '1904-01-02 18:00:00', '12:00']
      : ['1900-01-01', '1900-01-01 18:00:00', '12:00']);
  });

  it('keeps ambiguous text dates intact and flags numeric identifiers only in retained columns', async () => {
    const roster = await readExcelRoster(rosterFile([
      ['NAME', 'EDIPI', 'START_DATE', 'COUNT', 'MOS'],
      ['Recipient A', 42, '03/04/2026', 12, '0012'],
    ]));
    const selection = { roster, headerRow: 1 };
    const placeholders = ['NAME', 'EDIPI', 'START_DATE', 'COUNT', 'MOS', 'MISSING'];
    const mappings = autoMapRosterColumns(rosterHeaders(selection), placeholders);
    const [row] = mappedRosterRows(selection, mappings, placeholders);
    expect(row.values).toEqual({ NAME: 'Recipient A', EDIPI: '42', START_DATE: '03/04/2026', COUNT: '12', MOS: '0012' });
    expect(row.warnings.map(w => w.placeholder)).toEqual(['EDIPI', 'START_DATE']);
    const issues = rosterRowWarnings({ ...row, rosterWarnings: row.warnings }, placeholders);
    expect(issues.map(w => w.message).join('\n')).toContain('MISSING: Missing value');
    row.values.START_DATE = '2026-04-03';row.values.EDIPI = '0000000042';row.values.MISSING = 'Filled';
    expect(rosterRowWarnings({ ...row, rosterWarnings: row.warnings }, placeholders)).toEqual([]);
    expect(mappedRosterRows(selection, { 0: 'NAME' }, ['NAME'])[0].warnings).toEqual([]);
  });

  it('flags numeric risk using the mapped variable even when the header is unfamiliar', async () => {
    const roster = await readExcelRoster(rosterFile([['Service number'], [42]]));
    expect(mappedRosterRows({ roster, headerRow: 1 }, { 0: 'EDIPI' }, ['EDIPI'])[0].warnings[0].message).toMatch(/leading zeros/);
  });

  it('flags long numbers, cell errors and saved formula results without evaluating formulae', async () => {
    const sheet = utils.aoa_to_sheet([['CODE', 'BROKEN', 'FORMULA', 'TEXT_CODE'], [1234567890123456, 0, 42, '001234567890123456']]);
    sheet.B2 = { t: 'e', v: 7 };sheet.C2.f = '40+2';
    const roster = await readExcelRoster(rosterFile([], { sheet }));
    const cells = roster.rows[1].cells;
    expect(cells[0].warning).toMatch(/rounded/);
    expect(cells[1]).toMatchObject({ value: '', warning: expect.stringMatching(/cell error/) });
    expect(cells[2]).toMatchObject({ value: '42', warning: expect.stringMatching(/last saved result/) });
    expect(cells[3]).toEqual({ value: '001234567890123456' });
  });

  it('does not guess substring matches or duplicate headers', () => {
    expect(autoMapRosterColumns(['Name', 'Name', 'Start Date', '', 'Last Name'], ['NAME', 'START_DATE'])).toEqual({ 2: 'START_DATE' });
  });

  it('rejects an empty first worksheet even if another worksheet has data', async () => {
    await expect(readExcelRoster(rosterFile([], { secondSheet: [['NAME'], ['Ignored']] }))).rejects.toThrow(/first worksheet is empty/);
  });

  it('rejects unsupported, mislabeled, corrupt and oversized files with actionable messages', async () => {
    await expect(readExcelRoster(new File(['x'], 'roster.xls'))).rejects.toThrow(/Save older .xls/);
    await expect(readExcelRoster(new File(['NAME\nSample'], 'roster.xlsx'))).rejects.toThrow(/not an Excel workbook/);
    await expect(readExcelRoster(new File(['PK broken'], 'roster.xlsx'))).rejects.toThrow(/could not be read/);
    await expect(readExcelRoster(new File([new Uint8Array(ROSTER_LIMITS.bytes + 1)], 'roster.xlsx'))).rejects.toThrow(/smaller than 10 MB/);
  });

  it.each(['A5001', 'CW1'])('rejects an out-of-bounds worksheet (%s) without silently truncating it', async address => {
    const sheet = { A1: { t: 's' as const, v: 'NAME' }, [address]: { t: 's' as const, v: 'Outside limit' }, '!ref': `A1:${address}` };
    await expect(readExcelRoster(rosterFile([], { sheet }))).rejects.toThrow(/exceeds 5,000 rows or 100 columns/);
  });
});
