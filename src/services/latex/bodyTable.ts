import { BREAKABLE_TEXT_COMMANDS } from './bodyTableText';
import { bodyTableRowHeight, bodyTableSchema, bodyTableWidths, type BodyTable } from '@/lib/bodyTable';

interface TableRenderOptions {
  repeatHeaders?: boolean;
  wordIndex?: number;
  headerStyle?: 'underline';
  scope?: { begin: string; end: string };
  cellAdapter?: (row: number, column: number, header: boolean, latex: string) => string;
}

/** One geometry calculation feeds the PDF source and the Word conversion source. */
export function renderBodyTable(
  input: BodyTable,
  renderCell: (text: string, row: number, column: number, header: boolean) => string,
  options: TableRenderOptions = {},
): string {
  const table = bodyTableSchema.parse(input), columns = table.rows[0].length;
  const border = table.borders ?? 'grid';
  const columnRules = border === 'grid' || border === 'columns';
  const rules = columnRules ? columns + 1 : border === 'outline' ? 2 : 0;
  const fitLines = table.wrap === false && options.wordIndex === undefined;
  const alignments = { left: 'raggedright', center: 'centering', right: 'raggedleft' };
  const specifications = bodyTableWidths(table, 1).map((share, column) => {
    const width = `\\dimexpr${share.toFixed(6)}\\textwidth-2\\tabcolsep-${(rules / columns).toFixed(6)}\\arrayrulewidth\\relax`;
    // Pandoc otherwise treats leading cell digits as an argument to this command.
    return `>{\\${alignments[table.columnAlignments?.[column] ?? 'left']}\\arraybackslash${options.repeatHeaders === false ? '{}' : ''}}p{${width}}`;
  });
  // Measure the tallest cell of each header row once per emitted head group.
  // Body rows receive the remaining page height; semantic adapters are not rerun.
  const row = (cells: string[], index: number) => {
    const header = index < table.headerRows;
    const emphasis = (text: string) => header ? `\\${options.headerStyle === 'underline' ? 'underline' : 'textbf'}{${text}}` : text;
    const afterRowRule = border === 'grid' || border === 'columns' && index === table.headerRows - 1 && index < table.rows.length - 1;
    const cellsTex = cells.map((cell, column) => {
      let text = fitLines
        ? cell.split(/\r\n?|\n/).map(line => `\\dondocsSingleTableLine{${emphasis(renderCell(line, index, column, header))}}`).join('\\newline ')
        : emphasis(renderCell(cell, index, column, header));
      text = options.cellAdapter?.(index, column, header, text) ?? text;
      const minimum = bodyTableRowHeight(table, index);
      if (column === 0 && minimum) text = `\\rule{0pt}{${minimum}pt}${text}`;
      if (index === 0 && column === 0 && options.wordIndex !== undefined) text = `\\dondocsbodytable{${options.wordIndex}}${text}`;
      if (options.repeatHeaders !== false) {
        const headerSpace = table.repeatHeaders === false ? '' : '-\\dondocsTableHeaderHeight';
        const updateHeader = header ? `\\ifdim\\dimexpr\\ht0+\\dp0\\relax>\\dondocsTableRowHeight\\global\\dondocsTableRowHeight=\\dimexpr\\ht0+\\dp0\\relax\\fi ${column === columns - 1 ? '\\global\\advance\\dondocsTableHeaderHeight by\\dimexpr\\dondocsTableRowHeight+1pt\\relax\\ifdim\\dondocsTableHeaderHeight>\\dimexpr\\textheight-48pt\\relax\\errmessage{DonDocs: table headers are too tall for the page}\\fi ' : ''}`
          : `\\ifdim\\dimexpr\\ht0+\\dp0\\relax>\\dimexpr\\textheight-48pt${headerSpace}\\relax\\errmessage{DonDocs: a table row is too tall for the page; split the row or widen its columns}\\fi `;
        text = `${header && column === 0 ? '\\global\\dondocsTableRowHeight=1.2\\baselineskip ' : ''}\\begingroup\\setbox0=\\vbox{\\hsize=\\linewidth\\noindent ${text}\\par}${updateHeader}\\unvbox0\\endgroup`;
      }
      return text;
    });
    return cellsTex.join(' & ') + ` \\\\${afterRowRule ? ' \\hline' : ''}\n`;
  };
  const headerText = table.rows.slice(0, table.headerRows).map(row).join('');
  const headers = headerText && options.repeatHeaders !== false ? '\\noalign{\\global\\dondocsTableHeaderHeight=0pt}\n' + headerText : headerText;
  const line = border === 'none' ? '' : '\\hline\n';
  // Pandoc materializes both longtable header groups as real rows. The Word
  // post-pass applies repetition to one set of rows, never duplicated content.
  const headerEnd = options.repeatHeaders === false ? (headers ? '\\endhead\n' : '')
    : headers || border === 'columns'
      ? `\\endfirsthead\n${table.repeatHeaders === false ? border === 'columns' ? line : '' : line + headers}\\endhead\n` : '';
  const spec = columnRules ? `|${specifications.join('|')}|` : `${border === 'outline' ? '|' : ''}${specifications.join('')}${border === 'outline' ? '|' : ''}`;
  const fit = fitLines ? String.raw`\long\def\dondocsSingleTableLine#1{\begingroup\setbox2=\hbox{\linewidth=\maxdimen #1}\ifdim\wd2>\linewidth\resizebox{\linewidth}{\height}{\box2}\else\box2\fi\endgroup}
` : '';
  const helpers = options.repeatHeaders === false ? '' : BREAKABLE_TEXT_COMMANDS + String.raw`\ifcsname dondocsTableHeaderHeight\endcsname\else\newdimen\dondocsTableHeaderHeight\newdimen\dondocsTableRowHeight\fi
\global\dondocsTableHeaderHeight=0pt
`;
  const foot = border === 'columns' && options.repeatHeaders !== false ? '\\hline\\endfoot\n' : '';
  const bottom = border === 'outline' || border === 'columns' && !foot ? line : '';
  return `\\par\\vspace{12pt}\n{${helpers}${fit}${table.fontSize ? `\\fontsize{${table.fontSize}}{${table.fontSize * 1.2}}\\selectfont\n` : ''}\\renewcommand{\\arraystretch}{1.2}\n\\begin{longtable}{${spec}}\n${options.scope ? `\\noalign{${options.scope.begin}}\n` : ''}${line}${headers}${headerEnd}${foot}${table.rows.slice(table.headerRows).map((cells, index) => row(cells, index + table.headerRows)).join('')}${bottom}${options.scope ? `\\noalign{${options.scope.end}}\n` : ''}\\end{longtable}}\n`;
}
