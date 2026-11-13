import { describe, expect, it } from 'vitest';
import { utils } from 'xlsx';
import JSZip from 'jszip';
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

  it('preserves complete General-format numbers instead of rounded display text', async () => {
    const roster = await readExcelRoster(rosterFile([['ACCOUNT', 'AMOUNT'], [123456789012, 1.23456789012345]]));
    expect(roster.rows[1].cells.map(cell => cell.value)).toEqual(['123456789012', '1.23456789012345']);
  });

  it('flags camel-case identifiers and two-digit years without hiding formula warnings', async () => {
    const sheet = utils.aoa_to_sheet([['employeeId', 'DATE'], [42, '31/12/26']]);
    sheet.B2.f = '"31/12/26"';
    const roster = await readExcelRoster(rosterFile([], { sheet }));
    const [row] = mappedRosterRows({ roster, headerRow: 1 }, { 0: 'NAME', 1: 'DATE' }, ['NAME', 'DATE']);
    const messages = rosterRowWarnings({ ...row, rosterWarnings: row.warnings }, ['NAME', 'DATE']).map(warning => warning.message).join('\n');
    expect(messages).toContain('leading zeros');
    expect(messages).toContain('last saved result');
    expect(messages).toContain('Ambiguous date');
  });

  it('flags identifiers that Excel has converted to dates', async () => {
    const sheet = utils.aoa_to_sheet([['CODE', 'EVENT_DATE'], [45000, 45000]]);
    sheet.A2.z = 'm/d/yy';sheet.B2.z = 'm/d/yy';
    const roster = await readExcelRoster(rosterFile([], { sheet }));
    const [row] = mappedRosterRows({ roster, headerRow: 1 }, { 0: 'CODE', 1: 'EVENT_DATE' }, ['CODE', 'EVENT_DATE']);
    expect(row.warnings).toEqual([{ placeholder: 'CODE', value: '2023-03-15', message: expect.stringMatching(/original identifier may have changed/) }]);
  });

  it('checks actual row/cell bounds even when worksheet dimensions are incorrect', async () => {
    for (const address of ['A5001', 'A6000', 'CW2']) {
      const sheet = { A1: { t: 's' as const, v: 'NAME' }, [address]: { t: 's' as const, v: 'Outside limit' }, '!ref': `A1:${address}` };
      const zip = await JSZip.loadAsync(await rosterFile([], { sheet }).arrayBuffer());
      zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml')!.async('string')).replace(/<dimension[^>]*\/>/, '<dimension ref="A1"/>'));
      const file = new File([await zip.generateAsync({ type: 'arraybuffer' })], 'wrong-dimensions.xlsx');
      await expect(readExcelRoster(file)).rejects.toThrow(/exceeds 5,000 rows or 100 columns/);
    }
  });

  it('ignores inflated dimensions when the actual worksheet fits the roster limits', async () => {
    const zip = await JSZip.loadAsync(await rosterFile([['NAME'], ['Recipient A']]).arrayBuffer());
    zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml')!.async('string')).replace(/<dimension[^>]*\/>/, '<dimension ref="A1:XFD1048576"/>'));
    const roster = await readExcelRoster(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'stale-dimensions.xlsx'));
    expect(roster.rows.map(row => row.cells[0].value)).toEqual(['NAME', 'Recipient A']);
  });

  it('checks the first worksheet relationship rather than assuming sheet1 is first', async () => {
    const zip = await JSZip.loadAsync(await rosterFile([['Ignored']], { secondSheet: [['NAME'], ['Recipient A']] }).arrayBuffer());
    const workbook = await zip.file('xl/workbook.xml')!.async('string');
    zip.file('xl/workbook.xml', workbook.replace(/(<sheet name="Roster"[^>]*\/>)\s*(<sheet name="Ignored"[^>]*\/>)/, '$2$1'));
    // The later worksheet can exceed roster limits when it is not selected.
    zip.file('xl/worksheets/sheet1.xml', (await zip.file('xl/worksheets/sheet1.xml')!.async('string')).replace('r="A1"', 'r="A9000"'));
    const roster = await readExcelRoster(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'reordered.xlsx'));
    expect(roster.sheetName).toBe('Ignored');
    expect(roster.rows.map(row => row.cells[0].value)).toEqual(['NAME', 'Recipient A']);
  });

  it('rejects a different ZIP-based format renamed as .xlsx', async () => {
    const zip = new JSZip().file('content.xml', '<document/>');
    await expect(readExcelRoster(new File([await zip.generateAsync({ type: 'arraybuffer' })], 'renamed.xlsx'))).rejects.toThrow(/not an Excel .xlsx workbook/);
  });

  it('bounds actual ZIP expansion before parsing the workbook', async () => {
    const zip = await JSZip.loadAsync(await rosterFile([['NAME'], ['Recipient A']]).arrayBuffer());
    zip.file('xl/media/oversized.txt', 'x'.repeat(64 * 1024));
    const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
    expect(bytes.byteLength).toBeLessThan(32 * 1024);
    const originalLimit = ROSTER_LIMITS.expandedBytes;
    ROSTER_LIMITS.expandedBytes = 32 * 1024;
    try {
      await expect(readExcelRoster(new File([bytes], 'expanded.xlsx'))).rejects.toThrow(/when expanded/);
    } finally { ROSTER_LIMITS.expandedBytes = originalLimit; }
  });

  it('enforces the cell limit before materializing worksheet cells', async () => {
    const originalLimit = ROSTER_LIMITS.cells;
    ROSTER_LIMITS.cells = 2;
    try {
      await expect(readExcelRoster(rosterFile([['NAME'], ['Recipient A'], ['Recipient B']]))).rejects.toThrow(/exceeds 100,000 cells/);
    } finally { ROSTER_LIMITS.cells = originalLimit; }
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
