import { deriveOverallClassLevel } from '@/lib/overallClassification';
import { sl3Portions } from '@/data/techpub/sl3';
import type { DocumentData, Paragraph } from '@/types/document';
import {
  SL3_CATEGORIES,
  SL3_INVENTORY_GRID,
  emptySl3,
  orderedSl3Components,
  sl3Depth,
  sl3FigureIds,
  type Sl3Component,
} from '@/data/techpub/sl3';
import { SL3_PREFACE } from '@/data/techpub/sl3Preface';
import { escapeLatex } from './escaper';
import { figureFile } from '@/lib/figures';

type Store = { formData: Partial<DocumentData>; paragraphs: Paragraph[] };
const text = (s: string) => escapeLatex(s).replace(/\r?\n/g, '\\par ');
const paragraph = (s: string) => `${text(s)}\\par\\vspace{6pt}\n`;
const fixedPrefaceText = (s: string) =>
  text(s).replaceAll(
    'https://app.mcboss.usmc.mil/suite/sites/publications',
    '\\dondocsExternalLink{https://app.mcboss.usmc.mil/suite/sites/publications}{https://app.mcboss.usmc.mil/suite/sites/publications}',
  );

export function generateSl3Body(store: Store): string {
  const data = store.formData.sl3 ?? emptySl3();
  const items = orderedSl3Components(data);
  const figures = store.paragraphs.filter((p) => p.figure);
  const classified = [
    'confidential',
    'secret',
    'top_secret',
    'top_secret_sci',
  ].includes(
    deriveOverallClassLevel(store.formData.classLevel, [
      ...store.paragraphs,
      ...sl3Portions(data),
    ]),
  );
  const mark = (portion = 'U') => (classified ? `(${portion}) ` : '');
  const figureIds = sl3FigureIds(data);
  const figureNumber = (id: string) => figureIds.indexOf(id) + 1;
  const figureTitle = (id: string) =>
    figures.find((p) => p.referenceId === id)?.text ?? '';
  const entry = (title: string, destination: string, indent = false) =>
    `${indent ? '\\hspace*{0.2in}' : ''}\\slThreeNavigationTitle{${destination}}{${text(title)}}\\nobreak\\dotfill\\dondocsReferenceLink{${destination}}{\\slThreePageReference{${destination}}}\\par\n`;
  const heading = (title: string, destination: string, children = 0) =>
    `\\dondocsBookmark{${-children}}{${title}}{${destination}}\\begin{center}{\\fontsize{14}{16}\\selectfont\\textbf{${title}}}\\end{center}\\vspace{12pt}\n`;
  const prefaceTitles = SL3_PREFACE.filter((p) => !p.note).map(
    (p) => p.text.split('. ')[0],
  );
  const anchored = new Set<string>();
  const figure = (id: string, numbers: number[] = []) => {
    const n = figureNumber(id);
    const originalIndex = figures.findIndex((p) => p.referenceId === id);
    const p = figures[originalIndex];
    if (!p?.figure?.fileRef) {
      if (!numbers.length) return '\\begin{center}Not Shown\\end{center}\n';
      const cells = numbers.map(
        (number) =>
          `\\begin{minipage}[c][0.65in][c]{0.21\\textwidth}\\centering Not Shown\\par ${number}\\end{minipage}`,
      );
      while (cells.length % 4) cells.push('');
      return (
        '\\begin{tabularx}{\\textwidth}{XXXX}\n' +
        Array.from(
          { length: cells.length / 4 },
          (_, i) =>
            cells.slice(i * 4, i * 4 + 4).join(' & ') + '\\tabularnewline\n',
        ).join('') +
        '\\end{tabularx}\n'
      );
    }
    const file = figureFile(
      originalIndex + 1,
      p.figure.type,
      p.figure.name,
      p.figure.fileRef.id,
    );
    const anchor = anchored.has(id)
      ? ''
      : `\\dondocsReferenceAnchor{sl3.figure.${n}}\\label{sl3.figure.${n}}`;
    anchored.add(id);
    return (
      `\\slThreeFigureBlock{${anchor}\\begin{center}${mark(p.figure.portionMarking)}\\par\\includegraphics[width=\\textwidth,height=4.3in,keepaspectratio]{${file}}\\par\\vspace{18pt}\n` +
      `\\textbf{${mark(p.portionMarking)}Figure ${n}.\\quad ${text(p.text)}}\\par\\vspace{6pt}\n${numbers.length ? 'Item ' + numbers.join(', ') : ''}\\end{center}}\n`
    );
  };
  const out = [
    '\\fontsize{10}{12}\\selectfont\n',
    heading('TABLE OF CONTENTS', 'sl3.toc'),
    entry('AUTHENTICATION', 'itype.authentication'),
    ...(figureIds.length ? [entry('LIST OF ILLUSTRATIONS', 'sl3.loi')] : []),
    entry('LIST OF TABLES', 'sl3.lot'),
    entry('PREFACE', 'sl3.preface'),
    ...prefaceTitles.map((title, i) =>
      entry(`${i + 1}. ${title}`, `sl3.preface.${i + 1}`, true),
    ),
    entry('18. SPECIAL NOTES', 'sl3.notes', true),
    entry('TECHNICAL DATA', 'sl3.technical'),
    entry('Table 1. Components Inventory', 'sl3.inventory'),
    ...Object.keys(SL3_CATEGORIES)
      .filter(
        (category) =>
          category !== 'collateral' ||
          items.some((p) => p.category === category),
      )
      .map((category) =>
        entry(
          SL3_CATEGORIES[category as keyof typeof SL3_CATEGORIES].toUpperCase(),
          `sl3.${category}`,
          true,
        ),
      ),
    entry('INVENTORY CERTIFICATION', 'sl3.certification'),
    '\\clearpage\n',
    ...(figureIds.length
      ? [
          heading('LIST OF ILLUSTRATIONS', 'sl3.loi', figureIds.length),
          ...figureIds.map(
            (id, i) =>
              `\\slThreeOutlineLink{Figure ${i + 1}. ${text(figureTitle(id))}}{sl3.figure.${i + 1}}` +
              entry(
                `Figure ${i + 1}. ${figureTitle(id)}`,
                `sl3.figure.${i + 1}`,
              ),
          ),
          '\\vspace{18pt}\n',
        ]
      : []),
    heading('LIST OF TABLES', 'sl3.lot', 1),
    '\\slThreeOutlineLink{Table 1. Components Inventory}{sl3.inventory.table}\n',
    entry('Table 1. Components Inventory', 'sl3.inventory.table'),
    '\\clearpage\n',
    heading('PREFACE', 'sl3.preface', 18),
  ];
  let count = 0;
  for (const p of SL3_PREFACE) {
    if (p.note) {
      out.push(`\\slThreeFixedNote{${mark()}${fixedPrefaceText(p.text)}}\n`);
      continue;
    }
    out.push(
      `\\dondocsNeedspace{24pt}\\dondocsBookmark{0}{${count + 1}. ${text(prefaceTitles[count])}}{sl3.preface.${count + 1}}\\textbf{${++count}.} `,
    );
    out.push(mark() + fixedPrefaceText(p.text) + '\\par\\vspace{6pt}\n');
  }
  out.push(
    `\\dondocsNeedspace{36pt}\\dondocsBookmark{${-data.notes.length}}{18. SPECIAL NOTES}{sl3.notes}\\textbf{18. SPECIAL NOTES}\\par\\vspace{6pt}\n`,
  );
  if (
    !data.notes.length &&
    !data.sequencingNote &&
    !data.showFigureReference &&
    !data.showModel
  )
    out.push(paragraph('None.'));
  data.notes.forEach((note, i) =>
    out.push(
      `\\dondocsNeedspace{24pt}\\dondocsBookmark{0}{${i + 19}. ${text(note.text)}}{sl3.note.${i + 19}}\\textbf{${i + 19}.} ${mark(note.portionMarking)}${paragraph(note.text)}`,
    ),
  );
  if (data.sequencingNote)
    out.push(paragraph(mark(data.sequencingPortion) + data.sequencingNote));
  if (data.showFigureReference || data.showModel)
    out.push(
      paragraph(
        'Inventory columns are renumbered to include ' +
          [
            data.showFigureReference ? 'Figure Key / Reference Designator' : '',
            data.showModel ? 'Model Number' : '',
          ]
            .filter(Boolean)
            .join(' and ') +
          '.',
      ),
    );
  out.push(
    '\\clearpage' + heading('TECHNICAL DATA', 'sl3.technical'),
    paragraph(
      mark(data.technicalPortion) +
        'Source technical manual: ' +
        data.sourceManual,
    ),
    ...(data.configurationReference
      ? [
          paragraph(
            mark(data.technicalPortion) +
              'Configuration source: ' +
              data.configurationReference,
          ),
        ]
      : []),
    paragraph(mark(data.technicalPortion) + data.technicalData),
  );
  out.push(figure(data.endItemFigureId));
  out.push('\\clearpage\n');
  if (data.orientation === 'landscape') out.push('\\slThreeLandscape\n');
  else out.push('\\slThreePortraitInventory\n');
  out.push('\\pagestyle{slthreeinventory}\n');
  out.push('\\pagenumbering{arabic}\\fontsize{9}{11}\\selectfont\n');
  const optional = [
    data.showFigureReference ? 'Fig Key / Ref Des' : '',
    data.showModel ? 'Model' : '',
  ].filter(Boolean);
  // Seven logical columns; Periodic Inventory contains twelve writing cells.
  const sourceGrid = SL3_INVENTORY_GRID[data.orientation];
  const base = [...sourceGrid].map((twips) => twips / 20);
  const logical = [
    ...base.slice(0, 5),
    base.slice(5, 17).reduce((a, b) => a + b, 0),
    base[17],
  ];
  // Optional columns have no grid in the supplied templates. Preserve the NSN
  // and writing-cell widths; take their space from the description/remarks.
  logical[2] -= optional.length * 25.2;
  logical[6] -= optional.length * 25.2;
  logical.push(...optional.map(() => 50.4));
  const weights = [
    ...logical.slice(0, 5),
    ...base.slice(5, 17),
    ...logical.slice(6),
  ];
  const width = weights.map(
    (weight, i) =>
      `\\dimexpr${weight.toFixed(4)}bp-2\\tabcolsep-${i === weights.length - 1 ? '2' : '1'}\\arrayrulewidth\\relax`,
  );
  const spec =
    '|' +
    weights
      .map(
        (_, i) => `>{\\raggedright\\arraybackslash\\hspace{0pt}}p{${width[i]}}`,
      )
      .join('|') +
    '|';
  const headers = [
    'Item No.',
    'NSN',
    'Item Identification',
    'U/M',
    'Qty in Unit',
    'Periodic Inventory',
    'Using Unit Remarks',
    ...optional,
  ];
  const rowContent = (item: Sl3Component) => {
    const depth = sl3Depth(item, items);
    const number = items.indexOf(item) + 1;
    const children = items.some((p) => p.parentId === item.id);
    const notes = item.noteIds
      .map((id) => data.notes.findIndex((note) => note.id === id) + 19)
      .filter((n) => n >= 19);
    const refs = notes
      .map((n) => `\\dondocsReferenceLink{sl3.note.${n}}{${n}}`)
      .join(', ');
    const identification =
      `${mark(item.portionMarking)}${depth ? text(item.quantity) + ' - ' : ''}${text(item.nomenclature)}${item.description ? ': ' + text(item.description) : ''}` +
      (refs
        ? `; (See Special Note${notes.length > 1 ? 's' : ''} ${refs}.)`
        : '') +
      (item.partNumber
        ? `; \\slThreeIdentifier{PN ${text(item.partNumber)}}`
        : '') +
      (item.cage ? ` \\slThreeIdentifier{CAGE ${text(item.cage)}}` : '') +
      `; U/I ${text(item.unitOfIssue)}` +
      (item.tamcn ? `; \\slThreeIdentifier{TAMCN ${text(item.tamcn)}}` : '') +
      (item.idNumber
        ? `; \\slThreeIdentifier{ID ${text(item.idNumber)}}`
        : '') +
      (item.primaryTamcn
        ? `; Primary TAMCN ${text(item.primaryTamcn)}; ratio ${text(item.configurationRatio)}`
        : '') +
      (children ? '; c/o' : '');
    const indent = depth === 0 ? 0 : depth === 1 ? 0.1 : 0.28;
    const desc = `{\\leftskip=${indent}in\\hangindent=${depth === 0 ? '0.1' : '0.18'}in\\hangafter=1 ${identification}\\par}`;
    return [
      item.figureId
        ? `\\dondocsReferenceLink{sl3.figure.${figureNumber(item.figureId)}}{${number}}`
        : String(number),
      item.nsn ? `\\slThreeIdentifier{${text(item.nsn)}}` : '',
      desc,
      text(item.unit),
      depth ? '' : text(item.quantity),
      ...Array.from({ length: 12 }, () => ''),
      item.serialized ? '*Serial No.' : '',
      ...[
        data.showFigureReference ? text(item.figureReference) : undefined,
        data.showModel ? text(item.model) : undefined,
      ].filter((v) => v !== undefined),
    ].join(' & ');
  };
  out.push(
    `\\dondocsBookmark{${-(data.components.some((p) => p.category === 'collateral') ? 3 : 2)}}{Table 1. Components Inventory}{sl3.inventory}\\dondocsReferenceAnchor{sl3.inventory.table}\\label{sl3.inventory.table}\n`,
  );
  let inventorySheet = 0;
  for (const category of Object.keys(
    SL3_CATEGORIES,
  ) as (keyof typeof SL3_CATEGORIES)[]) {
    const categoryItems = items.filter((p) => p.category === category);
    if (!categoryItems.length && category === 'collateral') continue;
    out.push(
      `\\dondocsBookmark{0}{${SL3_CATEGORIES[category].toUpperCase()}}{sl3.${category}}\n`,
    );
    let start = 0;
    do {
      // The first category heading counts toward the template's 16-row limit.
      const limit = data.rowsPerSheet - (start === 0 ? 1 : 0);
      let end = Math.min(start + limit, categoryItems.length);
      while (
        end > start + 1 &&
        end < categoryItems.length &&
        categoryItems[end].parentId === categoryItems[end - 1].id
      )
        end--;
      const pageItems = categoryItems.slice(start, end);
      out.push(
        `\\setlength{\\tabcolsep}{0.25pt}\\renewcommand{\\arraystretch}{1.5}\n`,
        `\\begin{center}\\textbf{Table 1.\\quad Components Inventory${inventorySheet++ ? ' - Continued' : ''}}\\end{center}\\vspace{6pt}\n`,
      );
      for (let i = 0; i < pageItems.length; i++) {
        const group = [pageItems[i]];
        while (
          i + 1 < pageItems.length &&
          pageItems[i + 1].parentId === pageItems[i].id
        )
          group.push(pageItems[++i]);
        out.push(
          `\\slThreeCheckRows{${spec}}{${group.map(rowContent).join('\\tabularnewline ')}\\tabularnewline}\n`,
        );
      }
      const header = headers
        .map((h, i) =>
          i === 5
            ? // Single-column spans establish every physical width on the first
              // LaTeX pass. A 12-column span makes longtable inflate its last cell
              // until a later pass, which the live preview does not guarantee.
              Array.from(
                { length: 12 },
                (_, cell) =>
                  `\\multicolumn{1}{${cell === 0 ? '|' : ''}p{\\dimexpr${width[5 + cell]}${cell < 11 ? '+\\arrayrulewidth' : ''}\\relax}${cell === 11 ? '|' : ''}}{${cell === 0 ? `\\makebox[0pt][l]{\\parbox[t]{\\dimexpr${logical[5].toFixed(4)}bp-2\\tabcolsep-\\arrayrulewidth\\relax}{\\raggedright\\textbf{6}\\par Periodic Inventory (See paragraph \\dondocsReferenceLink{sl3.preface.8}{8} in Preface.)}}` : ''}}`,
              ).join(' & ')
            : `\\textbf{${i + 1}}\\par ${h}`,
        )
        .join(' & ');
      const categoryRow =
        start === 0
          ? `\\multicolumn{${weights.length}}{|l|}{\\textbf{${SL3_CATEGORIES[category].toUpperCase()}}}\\tabularnewline\\hline`
          : '';
      out.push(
        `\\slThreeCheckSheet{${spec}}{${header}\\tabularnewline\\hline ${categoryRow}${pageItems.map(rowContent).join('\\tabularnewline ')}\\tabularnewline}\n`,
      );
      out.push(
        `\\begin{longtable}{${spec}}\\hline ${header}\\tabularnewline\\hline\\endfirsthead\n\\multicolumn{${weights.length}}{c}{\\textbf{Table 1. Components Inventory - Continued}}\\tabularnewline\n${header}\\tabularnewline\\hline\\endhead\n\\endfoot\\hline\\endlastfoot\n`,
      );
      if (start === 0)
        out.push(
          `\\multicolumn{${weights.length}}{|l|}{\\textbf{${SL3_CATEGORIES[category].toUpperCase()}}}\\tabularnewline*\\hline\n`,
        );
      if (!pageItems.length)
        out.push(
          `\\multicolumn{${weights.length}}{|l|}{None.}\\tabularnewline\n`,
        );
      for (let i = 0; i < pageItems.length; i++) {
        const hasImmediateChild =
          pageItems[i + 1]?.parentId === pageItems[i].id;
        out.push(
          rowContent(pageItems[i]) +
            `\\tabularnewline${hasImmediateChild ? '*' : ''}\\hline\n`,
        );
      }
      out.push(
        '\\end{longtable}\\vspace{6pt}\nInventory Legend: C = Complete\\quad I = Incomplete\\quad S = Serviceable\\quad U = Unserviceable\\quad M = Missing\\par\n',
      );
      if (pageItems.length) {
        out.push('\\clearpage\n');
        const grouped = new Map<string, number[]>();
        for (const item of pageItems)
          grouped.set(item.figureId, [
            ...(grouped.get(item.figureId) ?? []),
            items.indexOf(item) + 1,
          ]);
        let first = true;
        for (const [id, numbers] of grouped) {
          if (!first) out.push('\\clearpage\n');
          out.push(figure(id, numbers));
          first = false;
        }
      }
      out.push('\\clearpage\n');
      start = end;
    } while (start < categoryItems.length);
  }
  out.push(
    heading('INVENTORY CERTIFICATION', 'sl3.certification') +
      '\\vspace{24pt}\n\\begin{tabularx}{\\textwidth}{XXX}INVENTORIED BY & SUPERVISED BY & DATE\\tabularnewline\\vspace{24pt}\\hrulefill & \\hrulefill & \\hrulefill\\tabularnewline Signature of inventory preparer & Signature of inventory supervisor & Date inventory completed\\end{tabularx}\n',
  );
  return out.join('');
}
