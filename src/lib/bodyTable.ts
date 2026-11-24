import { z } from 'zod';

export const BODY_TABLE_LIMITS = { rows: 100, columns: 12, cellCharacters: 4_000, characters: 100_000 } as const;

/** A native rectangular table. Cells use the editor's existing inline markers. */
export const bodyTableSchema = z.object({
  rows: z.array(z.array(z.string().max(BODY_TABLE_LIMITS.cellCharacters)).min(1).max(BODY_TABLE_LIMITS.columns)).min(1).max(BODY_TABLE_LIMITS.rows),
  headerRows: z.number().int().min(0).max(3),
  /** Percentages of the usable table width; five percent keeps cells printable. */
  columnWidths: z.array(z.number().finite().min(5).max(100)).min(1).max(BODY_TABLE_LIMITS.columns).optional(),
  columnAlignments: z.array(z.enum(['left', 'center', 'right'])).min(1).max(BODY_TABLE_LIMITS.columns).optional(),
  borders: z.enum(['grid', 'outline', 'columns', 'none']).optional(),
  wrap: z.boolean().optional(),
  fontSize: z.union([z.literal(10), z.literal(11), z.literal(12)]).optional(),
  minimumRowHeight: z.number().finite().min(0).max(144).optional(),
  /** Null inherits the table-wide minimum; zero explicitly removes it. */
  rowHeights: z.array(z.number().finite().min(0).max(144).nullable()).min(1).max(BODY_TABLE_LIMITS.rows).optional(),
  repeatHeaders: z.boolean().optional(),
}).strict().superRefine((table, context) => {
  const columns = table.rows[0]?.length ?? 0;
  if (table.headerRows > table.rows.length || table.rows.some(row => row.length !== columns)) {
    context.addIssue({ code: 'custom', message: 'Use a rectangular table with complete header rows.' });
  }
  if (table.rows.reduce((total, row) => total + row.reduce((size, cell) => size + cell.length, 0), 0) > BODY_TABLE_LIMITS.characters) {
    context.addIssue({ code: 'custom', message: 'The table exceeds the supported text limit.' });
  }
  if ([table.columnWidths, table.columnAlignments].some(values => values && values.length !== columns)) {
    context.addIssue({ code: 'custom', message: 'Column formatting must match every table column.' });
  }
  if (table.rowHeights && table.rowHeights.length !== table.rows.length) {
    context.addIssue({ code: 'custom', message: 'Row heights must match every table row.' });
  }
  if (table.columnWidths && Math.abs(table.columnWidths.reduce((sum, value) => sum + value, 0) - 100) > 0.001) {
    context.addIssue({ code: 'custom', message: 'Column widths must total 100 percent.' });
  }
});
export type BodyTable = z.infer<typeof bodyTableSchema>;

/** Shared proportions for editor, PDF and Word; the final column absorbs rounding. */
export function bodyTableWidths(input: BodyTable, available = 100): number[] {
  const table = bodyTableSchema.parse(input);
  if (!Number.isFinite(available) || available <= 0) throw new Error('The table width must be positive.');
  const weights = table.columnWidths ?? table.rows[0].map(() => 1);
  const total = weights.reduce((sum, width) => sum + width, 0);
  const widths = weights.map(width => Math.floor(available * width / total * 1e6) / 1e6);
  widths[widths.length - 1] += available - widths.reduce((sum, width) => sum + width, 0);
  return widths;
}

export function bodyTableTwips(table: BodyTable, available: number): number[] {
  const widths = bodyTableWidths(table, available).map(Math.floor);
  widths[widths.length - 1] += available - widths.reduce((sum, width) => sum + width, 0);
  return widths;
}

/** A bounded text-fit estimate, deliberately independent of browser fonts. */
export function autofitBodyTable(table: BodyTable): BodyTable {
  bodyTableSchema.parse(table);
  const weights = table.rows[0].map((_, column) => Math.max(4, ...table.rows.map(row =>
    Math.min(80, Math.max(...row[column].split('\n').map(line => Array.from(line).length))))));
  const total = weights.reduce((sum, width) => sum + width, 0), free = 100 - weights.length * 5;
  return { ...table, columnWidths: weights.map(weight => 5 + free * weight / total) };
}

/** Redistribute the other columns while retaining their minimum printable width. */
export function resizeBodyTableColumn(table: BodyTable, column: number, percent: number): BodyTable {
  const widths = bodyTableWidths(table);
  if (!Number.isInteger(column) || column < 0 || column >= widths.length || !Number.isFinite(percent)) throw new Error('Choose a valid table column width.');
  if (widths.length === 1) return { ...table, columnWidths: [100] };
  const selected = Math.max(5, Math.min(100 - 5 * (widths.length - 1), percent));
  const free = 100 - selected - 5 * (widths.length - 1);
  const weights = widths.map((width, index) => index === column ? 0 : Math.max(0, width - 5));
  const total = weights.reduce((sum, width) => sum + width, 0);
  return { ...table, columnWidths: widths.map((_, index) => index === column ? selected : 5 + free * (total ? weights[index] / total : 1 / (widths.length - 1))) };
}

export function fitBodyTableColumn(table: BodyTable, column: number): BodyTable {
  return resizeBodyTableColumn(table, column, autofitBodyTable(table).columnWidths![column]);
}

/** A divider changes the two adjacent widths and preserves every other column. */
export function resizeBodyTableBoundary(table: BodyTable, boundary: number, percent: number): BodyTable {
  const widths = table.columnWidths ? [...table.columnWidths] : bodyTableWidths(table);
  if (!Number.isInteger(boundary) || boundary < 0 || boundary >= widths.length - 1 || !Number.isFinite(percent)) {
    throw new Error('Choose a valid table boundary.');
  }
  const pairWidth = widths[boundary] + widths[boundary + 1];
  const left = Math.max(5, Math.min(pairWidth - 5, percent));
  widths[boundary] = left;
  widths[boundary + 1] = pairWidth - left;
  return { ...table, columnWidths: widths };
}

export function bodyTableRowHeight(table: Pick<BodyTable, 'minimumRowHeight' | 'rowHeights'>, row: number): number | undefined {
  return table.rowHeights?.[row] ?? table.minimumRowHeight;
}

export function assertRichBlockShape(paragraph: { bodyTable?: unknown; figure?: { placement?: string }; tableKey?: unknown; callout?: unknown; procedure?: unknown; appendix?: unknown }): void {
  if (paragraph.bodyTable && (paragraph.figure || paragraph.tableKey || paragraph.callout || paragraph.procedure || paragraph.appendix)
    || paragraph.figure?.placement === 'body' && (paragraph.tableKey || paragraph.callout || paragraph.procedure || paragraph.appendix)) {
    throw new Error('A body table or body image must have its own native block. Separate conflicting content before saving or exporting.');
  }
}

export function hasRichBody(source: { paragraphs?: readonly { bodyTable?: unknown; figure?: { placement?: string; altText?: string } }[]; formData?: { wordSource?: unknown } }): boolean {
  return !!source.formData?.wordSource || !!source.paragraphs?.some(paragraph => paragraph.bodyTable || paragraph.figure?.placement === 'body' || paragraph.figure?.altText !== undefined);
}
