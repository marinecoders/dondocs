import { BREAKABLE_TEXT_COMMANDS } from './bodyTableText';
import { bodyTableSchema, bodyTableWidths, type BodyTable } from '@/lib/bodyTable';

/** One geometry calculation feeds the PDF source and the Word conversion source. */
export function renderBodyTable(input: BodyTable, renderCell: (text: string, row: number, column: number, header: boolean) => string, options: { repeatHeaders?: boolean; wordIndex?: number; scope?: { begin: string; end: string } } = {}): string {
  const table = bodyTableSchema.parse(input), columns = table.rows[0].length;
  const border = table.borders ?? 'grid';
  const rules = border === 'grid' ? columns + 1 : border === 'outline' ? 2 : 0;
  const alignments = { left: 'raggedright', center: 'centering', right: 'raggedleft' };
  const specifications = bodyTableWidths(table, 1).map((share, column) => {
    const width = `\\dimexpr${share.toFixed(6)}\\textwidth-2\\tabcolsep-${(rules / columns).toFixed(6)}\\arrayrulewidth\\relax`;
    return `>{\\${alignments[table.columnAlignments?.[column] ?? 'left']}\\arraybackslash}p{${width}}`;
  });
  // Measure the tallest cell of each header row once per emitted head group.
  // Body rows receive the remaining page height; semantic adapters are not rerun.
  const row = (cells: string[], index: number) => cells.map((cell, column) => {
    let text = renderCell(cell, index, column, index < table.headerRows);
    if (index < table.headerRows) text = `\\textbf{${text}}`;
    if (column === 0 && table.minimumRowHeight) text = `\\rule{0pt}{${table.minimumRowHeight}pt}${text}`;
    if (index === 0 && column === 0 && options.wordIndex !== undefined) text = `\\dondocsbodytable{${options.wordIndex}}${text}`;
    if (options.repeatHeaders !== false) {
      const header = index < table.headerRows;
      const headerSpace = table.repeatHeaders === false ? '' : '-\\dondocsTableHeaderHeight';
      const updateHeader = header ? `\\ifdim\\dimexpr\\ht0+\\dp0\\relax>\\dondocsTableRowHeight\\global\\dondocsTableRowHeight=\\dimexpr\\ht0+\\dp0\\relax\\fi ${column === columns - 1 ? '\\global\\advance\\dondocsTableHeaderHeight by\\dimexpr\\dondocsTableRowHeight+1pt\\relax\\ifdim\\dondocsTableHeaderHeight>\\dimexpr\\textheight-48pt\\relax\\errmessage{DonDocs: table headers are too tall for the page}\\fi ' : ''}`
        : `\\ifdim\\dimexpr\\ht0+\\dp0\\relax>\\dimexpr\\textheight-48pt${headerSpace}\\relax\\errmessage{DonDocs: a table row is too tall for the page; split the row or widen its columns}\\fi `;
      text = `${header && column === 0 ? '\\global\\dondocsTableRowHeight=1.2\\baselineskip ' : ''}\\begingroup\\setbox0=\\vbox{\\hsize=\\linewidth\\noindent ${text}\\par}${updateHeader}\\unvbox0\\endgroup`;
    }
    return text;
  }).join(' & ') + ` \\\\${border === 'grid' ? ' \\hline' : ''}\n`;
  const headerText = table.rows.slice(0, table.headerRows).map(row).join('');
  const headers = headerText && options.repeatHeaders !== false ? '\\noalign{\\global\\dondocsTableHeaderHeight=0pt}\n' + headerText : headerText;
  const line = border === 'none' ? '' : '\\hline\n';
  // Pandoc materializes both longtable header groups as real rows. The Word
  // post-pass applies repetition to one set of rows, never duplicated content.
  const headerEnd = options.repeatHeaders === false ? '\\endhead\n'
    : `\\endfirsthead\n${table.repeatHeaders === false ? '' : line + headers}\\endhead\n`;
  const spec = border === 'grid' ? `|${specifications.join('|')}|` : `${border === 'outline' ? '|' : ''}${specifications.join('')}${border === 'outline' ? '|' : ''}`;
  const helpers = options.repeatHeaders === false ? '' : BREAKABLE_TEXT_COMMANDS + String.raw`\ifcsname dondocsTableHeaderHeight\endcsname\else\newdimen\dondocsTableHeaderHeight\newdimen\dondocsTableRowHeight\fi
\global\dondocsTableHeaderHeight=0pt
`;
  return `\\par\\vspace{12pt}\n{${helpers}${table.fontSize ? `\\fontsize{${table.fontSize}}{${table.fontSize * 1.2}}\\selectfont\n` : ''}\\renewcommand{\\arraystretch}{1.2}\n\\begin{longtable}{${spec}}\n${options.scope ? `\\noalign{${options.scope.begin}}\n` : ''}${line}${headers}${headers ? headerEnd : ''}${table.rows.slice(table.headerRows).map((cells, index) => row(cells, index + table.headerRows)).join('')}${border === 'outline' ? line : ''}${options.scope ? `\\noalign{${options.scope.end}}\n` : ''}\\end{longtable}}\n`;
}
