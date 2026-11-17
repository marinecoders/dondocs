import { bodyTableSchema, type BodyTable } from '@/lib/bodyTable';

/** Both export paths use the same rows and explicit repeated header count.
 * The callback also supplies a per-cell hook for semantic PDF marking. */
export function renderBodyTable(input: BodyTable, renderCell: (text: string, row: number, column: number, header: boolean) => string, options: { repeatHeaders?: boolean } = {}): string {
  const table = bodyTableSchema.parse(input), columns = table.rows[0].length;
  const width = `\\dimexpr(\\textwidth-${columns * 2}\\tabcolsep-${columns + 1}\\arrayrulewidth)/${columns}\\relax`;
  const row = (cells: string[], index: number) => cells.map((cell, column) => {
    const text = renderCell(cell, index, column, index < table.headerRows);
    return index < table.headerRows ? `\\textbf{${text}}` : text;
  }).join(' & ') + ' \\\\ \\hline\n';
  const headers = table.rows.slice(0, table.headerRows).map(row).join('');
  // Pandoc materializes both longtable header groups as real DOCX rows. One
  // endhead group retains its native header semantics without duplicating data.
  const headerEnd = options.repeatHeaders === false ? '\\endhead\n' : '\\endfirsthead\n\\hline\n' + headers + '\\endhead\n';
  return `\\par\\vspace{12pt}\n{\\renewcommand{\\arraystretch}{1.2}\n\\begin{longtable}{|${Array.from({ length: columns }, () => `p{${width}}`).join('|')}|}\n\\hline\n${headers}${headers ? headerEnd : ''}${table.rows.slice(table.headerRows).map((cells, index) => row(cells, index + table.headerRows)).join('')}\\end{longtable}}\n`;
}
