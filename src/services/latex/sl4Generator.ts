import { emptySl4, numberedSl4Parts, sl4FigureIds, sl4Portions, type Sl4Row } from '@/data/techpub/sl4';
import { SL4_TABLE_GRIDS } from '@/data/techpub/sl4Layout';
import { SL4_PREFACE, sl4LongDate as longDate, sl4PrefaceNumber, sl4PrefaceText } from '@/data/techpub/sl4Preface';
import { sl4Definitions } from '@/data/techpub/sl4Definitions';
import { paginateSl4Rows } from '@/lib/sl4Pagination';
import { buildSl4Indexes, sl4IndexPanels } from '@/lib/sl4References';
import { deriveOverallClassLevel } from '@/lib/overallClassification';
import { figureFile } from '@/lib/figures';
import { escapeLatex } from './escaper';
import { stockDefinitionText } from './stockPublicationHelpers';
import type { DocumentData, Paragraph } from '@/types/document';

export const sl4ItemDestination = (id: string) => `sl4.item.${Array.from(id).map((char) => char.codePointAt(0)!.toString(16)).join('-')}`;
const text = (value: string) => escapeLatex(value).replace(/\r?\n/g, '\\par ');
const identifier = (value: string) => value ? `\\slThreeIdentifier{${text(value)}}` : '';
const link = (id: string, value: string | number) => `\\dondocsReferenceLink{${id}}{${text(String(value))}}`;
const title = (value: string, id: string) => `\\dondocsBookmark{0}{${text(value)}}{${id}}\\begin{center}\\textbf{${text(value)}}\\end{center}\\vspace{12pt}\n`;
const entry = (value: string, id: string) => `\\slThreeNavigationEntry{${id}}{${value.split(/\s+/).map((word) => `\\uline{${text(word)}}`).join(' ')}}{0in}\n`;
const spec = (grid: readonly number[], ruled = true) => (ruled ? '|' : '@{}') + grid.map((width) =>
  `>{\\raggedright\\arraybackslash\\hspace{0pt}}p{\\dimexpr${width / 20}bp-2\\tabcolsep${ruled ? '-\\arrayrulewidth' : ''}\\relax}`,
).join(ruled ? '|' : '') + (ruled ? '|' : '@{}');
const panelSpec = (grid: readonly number[], panels: number) => grid.map((width, i) => {
  const separator = (i + 1) % (grid.length / panels) === 0 && i < grid.length - 1;
  return `>{\\raggedright\\arraybackslash\\hspace{0pt}}p{\\dimexpr${width / 20}bp-2\\tabcolsep${separator ? '-\\arrayrulewidth' : ''}\\relax}${separator ? '|' : ''}`;
}).join('');
const rowEnd = '\\tabularnewline[2bp]\n';

export function generateSl4Body(store: { formData: Partial<DocumentData>; paragraphs: Paragraph[] }): string {
  const data = store.formData.sl4 ?? emptySl4();
  const parts = numberedSl4Parts(data.rows);
  const numbered = new Map(parts.map((part) => [part.id, part.itemNumber]));
  const figures = store.paragraphs.filter((p) => p.figure);
  const figureIds = sl4FigureIds(data);
  const classified = ['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(
    deriveOverallClassLevel(store.formData.classLevel, [...store.paragraphs, ...sl4Portions(data, store.paragraphs)]));
  const mark = (portion = 'U') => classified ? `(${portion}) ` : '';
  const partTitles = [
    'PART I – ITEM IDENTIFICATION LISTING', 'PART II – ITEM NUMBER CROSS-REFERENCE',
    'PART III – NATIONAL STOCK NUMBER CROSS-REFERENCE', 'PART IV – PART NUMBER CROSS-REFERENCE',
    ...(data.circuitIndex.mode === 'include' ? ['PART V – CIRCUIT SYMBOL NUMBER TO ITEM NUMBER CROSS-REFERENCE'] : []),
  ];
  const usedFigures = new Set<string>();
  const figure = (id: string, wide: boolean) => {
    const i = figures.findIndex((p) => p.referenceId === id);
    const p = figures[i];
    if (!p?.figure?.fileRef) return '\\begin{center}Not Shown\\end{center}\n';
    const n = figureIds.indexOf(id) + 1;
    const file = figureFile(i + 1, p.figure.type, p.figure.name, p.figure.fileRef.id);
    const review = data.artwork.find((artwork) => artwork.figureId === id);
    const labels = (review?.labels ?? []).map((label) => `\\slThreeArtworkLabel{${Math.round(label.x * 10)}}{${Math.round(label.y * 10)}}{${text(label.text)}}`).join('');
    const anchor = usedFigures.has(id) ? '' : `\\dondocsReferenceAnchor{sl4.figure.${n}}\\label{sl4.figure.${n}}`;
    usedFigures.add(id);
    const references = parts.filter((part) => part.figureId === id).map((part) => link(sl4ItemDestination(part.id), part.itemNumber)).join(', ');
    return `\\clearpage\\slFourLayout{${wide ? 792 : 612}bp}{${wide ? 67 : 72}bp}\\fontsize{10}{12}\\selectfont\n` +
      `\\slThreeFigureBlock{${anchor}\\begin{center}${mark(p.figure.portionMarking)}\\par\\slThreeArtwork{${file}}{${labels}}\\par\\vspace{18pt}\n` +
      `\\textbf{${mark(p.portionMarking)}Figure ${n}.\\hspace{2\\fontdimen2\\font}${text(p.text)}}\\par` +
      (references ? `\\vspace{6pt}Item numbers: ${references}\\par` : '') + '\\end{center}}\n';
  };
  const out = [
    '\\fontsize{10}{12}\\selectfont\n',
    title('TABLE OF CONTENTS', 'sl4.toc'), entry('AUTHENTICATION', 'itype.authentication'),
    entry('RECORD OF CHANGES', 'sl4.revisions'), entry('PREFACE', 'sl4.preface'),
    entry('SOURCE MAINTENANCE RECOVERABILITY CODES', 'sl4.smr'),
    entry('ABBREVIATIONS', 'sl4.definitions'), entry('COMMERCIAL AND GOVERNMENT ENTITIES', 'sl4.cages'),
    ...(figureIds.length ? [entry('LIST OF ILLUSTRATIONS', 'sl4.loi')] : []), entry('LIST OF TABLES', 'sl4.lot'),
    ...partTitles.map((label, i) => entry(label, `sl4.part.${i + 1}`)),
    '\\clearpage\n', title('RECORD OF CHANGES', 'sl4.revisions'),
  ];
  const revisionRows = data.revisions.length ? data.revisions.map((revision) =>
    [revision.revision, longDate(revision.date), mark(revision.portionMarking) + revision.description, revision.enteredBy].map(text).join(' & ') + rowEnd,
  ) : Array.from({ length: 6 }, () => ' & & & ' + rowEnd);
  out.push(`\\setlength{\\tabcolsep}{3bp}\\begin{longtable}{${spec(SL4_TABLE_GRIDS.revisions)}}\\hline\nRevision No. & Date & Title or Brief Description & Entered By${rowEnd}\\hline\\endhead\n${revisionRows.join('\\hline\n')}\\hline\\end{longtable}\\clearpage\n`);
  out.push(title('PREFACE', 'sl4.preface'));
  for (const block of SL4_PREFACE) {
    if (!block.number && block.text === 'PREFACE') continue;
    if (!block.number) {
      out.push(`\\dondocsNeedspace{48pt}\\begin{center}\\textbf{${text(block.text)}}\\end{center}\\vspace{6pt}\n`);
      continue;
    }
    if (block.number === '7') out.push(`\\dondocsBookmark{0}{SOURCE MAINTENANCE RECOVERABILITY CODES}{sl4.smr}\n`);
    const sourceText = sl4PrefaceText(block.text, data.cutoffDate, store.formData.shortTitle ?? '');
    let value = text(sourceText);
    const endOfLead = sourceText.indexOf('.  ');
    if (endOfLead > 0 && /^\d+$/.test(block.number) && Number(block.number) >= 5 && Number(block.number) <= 14) {
      const lead = sourceText.slice(0, endOfLead), column = lead.indexOf(' (Column ');
      const bold = column < 0 ? `\\textbf{${text(lead)}}` : `\\textbf{${text(lead.slice(0, column))}}${text(lead.slice(column))}`;
      value = `${[5, 6, 7, 8, 9, 11, 12].includes(Number(block.number)) ? `\\uline{${bold}}` : bold}.\\hspace{2\\fontdimen2\\font}${text(sourceText.slice(endOfLead + 3))}`;
    }
    const prefix = sl4PrefaceNumber(block.number);
    const start = /[a-z]$/.test(block.number) ? '\\hspace*{18pt}' : '';
    out.push(`\\dondocsNeedspace{30pt}${start}\\textbf{${prefix}}\\hspace{6pt}${mark(block.number === '1' ? data.contextPortion : 'U')}${value}\\par\\vspace{6pt}\n`);
  }
  out.push('\\dondocsNeedspace{48pt}\\begin{center}\\textbf{SPECIAL NOTES}\\end{center}\\vspace{6pt}\n');
  if (!data.notes.length) out.push('\\textbf{21.}\\hspace{6pt}None.\\par\n');
  data.notes.forEach((note, i) => out.push(`\\dondocsNeedspace{30pt}\\textbf{${21 + i}.}\\hspace{6pt}${mark(note.portionMarking)}${text(note.text)}\\par\\vspace{6pt}\n`));
  if (data.circuitIndex.mode === 'omitted_excessive') out.push(`${mark(data.contextPortion)}Part V omitted: ${text(data.circuitIndex.reason)}\\par\n`);
  out.push('\\clearpage\n', title('ABBREVIATIONS', 'sl4.definitions'));
  for (const definition of sl4Definitions(data.definitions))
    out.push(`\\dondocsNeedspace{30pt}\\noindent\\textbf{${stockDefinitionText(mark(definition.portionMarking) + definition.term)}}: ${stockDefinitionText(definition.meaning)}\\par\\vspace{6pt}\n`);
  out.push('\\clearpage\n', title('COMMERCIAL AND GOVERNMENT ENTITIES', 'sl4.cages'));
  out.push('\\begin{longtable}{@{}p{0.65in}p{2.2in}p{3.2in}@{}}\\textbf{CAGE} & \\textbf{Entity} & \\textbf{Address}\\tabularnewline\\endhead\n');
  for (const cage of data.cages) out.push(`${text(cage.code)} & ${mark(cage.portionMarking)}${text(cage.name)} & ${text(cage.address)}${rowEnd}`);
  out.push('\\end{longtable}\n');
  if (figureIds.length) {
    out.push('\\clearpage\n', title('LIST OF ILLUSTRATIONS', 'sl4.loi'));
    figureIds.forEach((id, i) => out.push(entry(`Figure ${i + 1}. ${figures.find((p) => p.referenceId === id)?.text ?? ''}`, `sl4.figure.${i + 1}`)));
  }
  out.push('\\clearpage\n', title('LIST OF TABLES', 'sl4.lot'));
  partTitles.forEach((label, i) => out.push(entry(`Table ${i + 1}. ${label}`, `sl4.table.${i + 1}`)));
  if (data.endItemFigureId) out.push(figure(data.endItemFigureId, false));
  out.push('\\clearpage\\pagenumbering{arabic}\n');
  const left = (792 - SL4_TABLE_GRIDS.partI.reduce((sum, width) => sum + width / 20, 0) - 0.75) / 2;
  const partSpec = spec(SL4_TABLE_GRIDS.partI);
  const headers = [1, 2, 3, 4, 5, 6].map(number => `\\centering\\bfseries ${number}\\par`).join(' & ') +
    ' & \\multicolumn{2}{p{\\dimexpr48.95bp-2\\tabcolsep-\\arrayrulewidth\\relax}|}{\\centering\\bfseries 7\\par REPL} & \\centering\\bfseries 8\\par & \\multicolumn{2}{p{\\dimexpr79.2bp-2\\tabcolsep-\\arrayrulewidth\\relax}|}{\\centering\\bfseries 9\\par QTY}' + rowEnd +
    ['ITEM NO.', 'SMR', 'NSN', 'CAGE', 'PART NUMBER', 'ITEM IDENTIFICATION', '(a)\\par M\\par A\\par N', '(b)\\par E\\par C\\par O', 'U/M', '(a)\\par PER APPL', '(b)\\par PER EQUIP'].map((heading) => `\\centering\\bfseries ${heading}\\par`).join(' & ') + rowEnd + '\\hline\n';
  const rowText = (row: Sl4Row) => {
    if (row.kind === 'blank') return Array.from({ length: 11 }, () => '').join(' & ');
    if (row.kind === 'heading') return `\\multicolumn{11}{|p{\\dimexpr${SL4_TABLE_GRIDS.partI.reduce((sum, width) => sum + width / 20, 0)}bp-2\\tabcolsep-\\arrayrulewidth\\relax}|}{${mark(row.portionMarking)}{\\bfseries ${text(row.text)}}}`;
    let depth = 0, parent = row.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) { seen.add(parent); depth++; parent = parts.find((part) => part.id === parent)?.parentId ?? ''; }
    const relationship = row.relationship;
    const ref = relationship ? `${relationship.kind === 'same_as' ? 'S/A' : relationship.kind === 'fabricated_from' ? 'FAB FR' : 'ASSEM FR'} ${relationship.itemIds.map((id) => link(sl4ItemDestination(id), numbered.get(id) ?? '?')).join(', ')}` : '';
    const isParent = parts.some((part) => part.parentId === row.id);
    const identification = `${mark(row.portionMarking)}${text(row.nomenclature)}${relationship?.kind === 'same_as' ? ` (${ref})` : ''}${row.description ? ':\\hspace{2\\fontdimen2\\font}' + text(row.description) : ''}${relationship && relationship.kind !== 'same_as' ? '; ' + ref : ''}${row.circuitSymbols.length ? '; ' + text(row.circuitSymbols.join(', ')) : ''}${isParent ? '; c/o' : ''}`;
    return [
      `\\dondocsReferenceAnchor{${sl4ItemDestination(row.id)}}${row.figureId ? link(`sl4.figure.${figureIds.indexOf(row.figureId) + 1}`, numbered.get(row.id) ?? '?') : numbered.get(row.id)}`,
      identifier(row.smr), identifier(row.nsn), identifier(row.cage), identifier(row.partNumber),
      `\\parbox[t]{\\linewidth}{\\raggedright\\leftskip=${Math.min(depth * 7.2, 36)}bp ${identification}\\strut}`,
      row.mandatoryReplacement ? 'X' : '', row.economicReplacement ? 'X' : '', identifier(row.unit),
      identifier(row.quantityPerApplication), identifier(row.quantityPerEquipment),
    ].join(' & ');
  };
  // An incomplete draft still gets a usable preview; export preflight refuses it.
  let sheets: Sl4Row[][];
  try { sheets = paginateSl4Rows(data.rows, data.rowsPerSheet); }
  catch { sheets = [data.rows]; }
  if (!sheets.length) sheets = [[]];
  sheets.forEach((rows, index) => {
    out.push(`\\clearpage\\slFourLayout{792bp}{${left}bp}\\fontsize{9}{11}\\selectfont\\setlength{\\tabcolsep}{2bp}\\setlength{\\arrayrulewidth}{0.75bp}\n`);
    if (index === 0) out.push(title(partTitles[0], 'sl4.part.1'), '\\dondocsReferenceAnchor{sl4.table.1}\\label{sl4.table.1}\n');
    out.push(`\\begin{center}\\textbf{Table 1.\\hspace{2\\fontdimen2\\font}Item Identification Listing${index ? ' - Continued' : ''}}\\end{center}\\vspace{6pt}\n`);
    const content = rows.map(rowText).join(rowEnd + '\\hline\n') + rowEnd;
    out.push(`\\slFourCheckTable{${partSpec}}{${headers}${content}}\n`);
    out.push(`\\begin{longtable}{${partSpec}}${index ? '' : '\\hline'}${headers}\\endhead\n${content}${index === sheets.length - 1 ? '\\hline' : ''}\\end{longtable}\n`);
    const ids = [...new Set(rows.flatMap((row) => row.kind === 'part' && row.figureId ? [row.figureId] : []))];
    ids.forEach((id) => out.push(figure(id, true)));
  });
  let indexes: ReturnType<typeof buildSl4Indexes>;
  try { indexes = buildSl4Indexes(data); }
  catch { indexes = { partII: [], partIII: [], partIV: [], partV: [] }; }
  for (const [offset, records] of [indexes.partII, indexes.partIII, indexes.partIV, ...(data.circuitIndex.mode === 'include' ? [indexes.partV] : [])].entries()) {
    const n = offset + 2;
    const grid = [SL4_TABLE_GRIDS.partII, SL4_TABLE_GRIDS.partIII, SL4_TABLE_GRIDS.partIV, SL4_TABLE_GRIDS.partV][offset];
    const panels = n === 5 ? 3 : 2;
    type IndexRow = ReturnType<typeof buildSl4Indexes>['partII'][number] | ReturnType<typeof buildSl4Indexes>['partV'][number];
    const panelRows = sl4IndexPanels<IndexRow>(records, Math.min(data.indexRowsPerPanel, classified ? 22 : 55), panels);
    if (!panelRows.length) panelRows.push(Array.from({ length: panels }, () => []));
    const columns = n === 2 ? ['ITEM NO.', 'PART NO.', 'CAGE'] : n === 3 ? ['STOCK NO.', 'ITEM NO.', 'CAGE', 'PART NO.'] : n === 4 ? ['PART NO.', 'CAGE', 'ITEM NO.', 'STOCK NO.'] : ['CIRCUIT SYMBOL NO.', 'ITEM NO.'];
    const columnSpec = panelSpec(grid, panels);
    const width = grid.reduce((sum, value) => sum + value / 20, 0);
    panelRows.forEach((page, pageIndex) => {
      out.push(`\\clearpage\\slFourLayout{612bp}{${(612 - width) / 2}bp}\\fontsize{8}{9.6}\\selectfont\\renewcommand{\\arraystretch}{1}\\setlength{\\tabcolsep}{2bp}\n`);
      if (pageIndex === 0) out.push(title(partTitles[n - 1], `sl4.part.${n}`), `\\dondocsReferenceAnchor{sl4.table.${n}}\\label{sl4.table.${n}}\n`);
      out.push(`\\begin{center}\\textbf{Table ${n}.\\hspace{2\\fontdimen2\\font}${text(partTitles[n - 1].split(' – ')[1])}${pageIndex ? ' - Continued' : ''}}\\end{center}\\vspace{6pt}\n`);
      const indexRowEnd = '\\tabularnewline\n';
      const header = Array.from({ length: panels }, () => columns).flat().map((column) => `\\textbf{${column}}`).join(' & ') + indexRowEnd + '\\hline\n';
      const body = Array.from({ length: Math.max(1, ...page.map((panel) => panel.length)) }, (_, row) => page.flatMap((panel) => {
        const item = panel[row];
        if (!item) return Array.from({ length: columns.length }, () => '');
        const itemLink = link(sl4ItemDestination(item.rowId), item.itemNumber);
        const marked = (value: string) => (classified ? text(mark(item.portionMarking).trim()) + '\\par ' : '') + identifier(value);
        if ('circuitSymbol' in item) return [marked(item.circuitSymbol), itemLink];
        return n === 2 ? [itemLink, marked(item.partNumber), identifier(item.cage)] : n === 3 ? [marked(item.nsn), itemLink, identifier(item.cage), identifier(item.partNumber)] : [marked(item.partNumber), identifier(item.cage), itemLink, identifier(item.nsn)];
      }).join(' & ') + indexRowEnd).join('');
      out.push(`\\slFourCheckTable{${columnSpec}}{${header}${body}}\\begin{longtable}{${columnSpec}}\\hline${header}\\endhead\n${body}\\hline\\end{longtable}\n`);
    });
  }
  return out.join('');
}
