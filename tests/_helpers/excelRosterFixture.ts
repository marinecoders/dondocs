import { utils, write, type WorkSheet } from 'xlsx';

/** Synthetic roster data only. Generate real OOXML rather than mocking the reader. */
export function rosterFile(rows: unknown[][], options: { sheet?: WorkSheet; secondSheet?: unknown[][]; date1904?: boolean; name?: string } = {}) {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, options.sheet ?? utils.aoa_to_sheet(rows), 'Roster');
  if (options.secondSheet) utils.book_append_sheet(workbook, utils.aoa_to_sheet(options.secondSheet), 'Ignored');
  workbook.Workbook = { WBProps: { date1904: options.date1904 ?? false } };
  const bytes = write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([bytes], options.name ?? 'sample-roster.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
