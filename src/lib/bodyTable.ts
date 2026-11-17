import { z } from 'zod';

export const BODY_TABLE_LIMITS = { rows: 100, columns: 12, cellCharacters: 4_000, characters: 100_000 } as const;

/** A native rectangular table. Cells use the editor's existing inline markers. */
export const bodyTableSchema = z.object({
  rows: z.array(z.array(z.string().max(BODY_TABLE_LIMITS.cellCharacters)).min(1).max(BODY_TABLE_LIMITS.columns)).min(1).max(BODY_TABLE_LIMITS.rows),
  headerRows: z.number().int().min(0).max(3),
}).strict().superRefine((table, context) => {
  if (table.headerRows > table.rows.length || table.rows.some(row => row.length !== table.rows[0].length)) {
    context.addIssue({ code: 'custom', message: 'Use a rectangular table with complete header rows.' });
  }
  if (table.rows.reduce((total, row) => total + row.reduce((size, cell) => size + cell.length, 0), 0) > BODY_TABLE_LIMITS.characters) {
    context.addIssue({ code: 'custom', message: 'The table exceeds the supported text limit.' });
  }
});
export type BodyTable = z.infer<typeof bodyTableSchema>;

export function assertRichBlockShape(paragraph: { bodyTable?: unknown; figure?: { placement?: string }; tableKey?: unknown; callout?: unknown; procedure?: unknown; appendix?: unknown }): void {
  if (paragraph.bodyTable && (paragraph.figure || paragraph.tableKey || paragraph.callout || paragraph.procedure || paragraph.appendix)
    || paragraph.figure?.placement === 'body' && (paragraph.tableKey || paragraph.callout || paragraph.procedure || paragraph.appendix)) {
    throw new Error('A body table or body image must have its own native block. Separate conflicting content before saving or exporting.');
  }
}

export function hasRichBody(source: { paragraphs?: readonly { bodyTable?: unknown; figure?: { placement?: string; altText?: string } }[]; formData?: { wordSource?: unknown } }): boolean {
  return !!source.formData?.wordSource || !!source.paragraphs?.some(paragraph => paragraph.bodyTable || paragraph.figure?.placement === 'body' || paragraph.figure?.altText !== undefined);
}
