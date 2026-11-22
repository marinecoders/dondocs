import { emptySl3, orderedSl3Components, sl3FigureIds, sl3InventoryGeometry, SL3_CATEGORIES, SL3_CERTIFICATION_LAYOUT } from '@/data/techpub/sl3';
import { sl3Definitions, SL3_PREFACE } from '@/data/techpub/sl3Preface';
import { emptySl4, numberedSl4Parts, sl4FigureIds } from '@/data/techpub/sl4';
import { SL4_PREFACE, sl4LongDate, sl4PrefaceNumber, sl4PrefaceText } from '@/data/techpub/sl4Preface';
import { sl4Definitions } from '@/data/techpub/sl4Definitions';
import { SL4_TABLE_GRIDS } from '@/data/techpub/sl4Layout';
import { buildSl4Indexes } from '@/lib/sl4References';
import { formatPublicationDate } from '@/lib/publicationDate';
import { iTypeDestructionNotice } from '@/lib/iTypeClassification';
import type { Paragraph } from '@/types/document';
import { authentication, endItemTable, publicationNotices } from './frontMatter';
import { publicationFigure } from './instructions';
import type { PublicationWordPorts, PublicationWordSource } from './index';
import type { PublicationWordPackage, SectionFormat } from './package';

const weights = (source: readonly number[], width: number) => {
  const sum = source.reduce((total, value) => total + value, 0);
  const result = source.map(value => Math.round(value * width / sum));
  result[result.length - 1] += width - result.reduce((total, value) => total + value, 0);
  return result;
};
const classified = (document: PublicationWordSource) => ['confidential', 'secret', 'top_secret', 'top_secret_sci'].includes(document.formData.classLevel ?? '');
const marker = (document: PublicationWordSource, portion = 'U') => classified(document) ? `(${portion}) ` : '';
const stockTitle = (docType: string) => `Components Stock List ${docType === 'sl3' ? 'SL-3' : 'SL-4'}`;
function hierarchyDepths(rows: readonly { id: string; parentId: string }[]): Map<string, number> {
  const parents = new Map(rows.map(row => [row.id, row.parentId]));
  const depths = new Map<string, number>();
  for (const row of rows) {
    const path: string[] = [], seen = new Set<string>();
    let current = row.id;
    while (current && !depths.has(current)) {
      if (seen.has(current) || !parents.has(current)) throw new Error('Correct the stock publication hierarchy before Word export.');
      seen.add(current); path.push(current); current = parents.get(current) ?? '';
    }
    let depth = current ? depths.get(current)! : -1;
    for (const id of path.reverse()) depths.set(id, ++depth);
  }
  return depths;
}

export function stockCover(word: PublicationWordPackage, document: PublicationWordSource, seal: Uint8Array, referenceDate: Date, section: SectionFormat): void {
  const data = document.formData;
  word.text(formatPublicationDate(data.date ?? '', referenceDate).toUpperCase(), { bold: true });
  word.text(data.shortTitle ?? '', { align: 'right', bold: true, size: 18 });
  word.text(`U.S. MARINE CORPS ${stockTitle(document.docType).toUpperCase()}`, { bold: true, size: 14, align: 'center' });
  word.text((data.subject ?? '').toUpperCase(), { bold: true, size: 14, style: 'Title', align: 'center' });
  word.text((data.nomenclature ?? '').toUpperCase(), { bold: true, size: 18, align: 'center' });
  word.image(seal, 'png', 120, 120, 'United States Marine Corps seal');
  if (document.endItems.length > 6) word.text('END ITEMS: See end-item continuation.', { align: 'center' });
  else endItemTable(word, document.endItems, 6);
  publicationNotices(word, data);
  const destruction = iTypeDestructionNotice(data, document.paragraphs);
  if (destruction) word.text(destruction, { size: 8 });
  word.text(`PCN ${data.pcn ?? ''}`, { bold: true, align: 'right' });
  word.endSection({ ...section, cover: true, hidePageNumber: true });
  if (document.endItems.length > 6) {
    word.heading('END ITEM CONTINUATION'); endItemTable(word, document.endItems);
    word.endSection({ ...section, start: 2, prefix: 'T-' });
  }
  word.registerTargets([{ name: 'PUBREF_STOCK_AUTHENTICATION', label: 'AUTHENTICATION', destination: 'itype.authentication' }]);
  word.anchor('itype.authentication');
  const tamcns = [...new Set(document.endItems.map(item => item.tamcn.trim()).filter(Boolean))].join(', ');
  authentication(word, data, referenceDate, false, document.docType === 'sl4' ? `Marine Corps Components Repair Parts List, ${data.shortTitle ?? ''}, TAMCN ${tamcns} is effective upon receipt.` : undefined);
  word.endSection({ ...section, start: 1, numbering: 'lowerRoman' });
}

function figureParagraph(document: PublicationWordSource, id: string): Paragraph {
  const paragraph = document.paragraphs.find(paragraph => paragraph.figure && paragraph.referenceId === id);
  if (!paragraph) throw new Error('A stock publication illustration is missing. Restore its source image before Word export.');
  return paragraph;
}

async function stockFigures(word: PublicationWordPackage, document: PublicationWordSource, ports: PublicationWordPorts, ids: readonly string[], prefix: string): Promise<void> {
  const artwork = document.docType === 'sl3' ? document.formData.sl3?.artwork : document.formData.sl4?.artwork;
  for (const [index, id] of ids.entries()) {
    const paragraph = figureParagraph(document, id);
    word.anchor(`${prefix}.figure.${index + 1}`, true);
    await publicationFigure(word, paragraph, ports, `${marker(document, paragraph.portionMarking)}Figure ${index + 1}. ${paragraph.text}`, artwork?.find(review => review.figureId === id)?.labels ?? []);
    if (document.docType === 'sl4' && document.formData.sl4) {
      const numbers = numberedSl4Parts(document.formData.sl4.rows).filter(part => part.figureId === id).map(part => `{{PUBREF_SL4_ITEM_${part.itemNumber}}}`);
      if (numbers.length) word.text(`Item numbers: ${numbers.join(', ')}`, { inlineMode: 'references' });
    } else if (document.formData.sl3) {
      const numbers = orderedSl3Components(document.formData.sl3).flatMap((item, index) => item.figureId === id ? [String(index + 1)] : []);
      if (numbers.length) word.text(`Item numbers: ${numbers.join(', ')}`, { inlineMode: 'references' });
    }
  }
}

export async function sl3Body(word: PublicationWordPackage, document: PublicationWordSource, ports: PublicationWordPorts, section: SectionFormat): Promise<SectionFormat> {
  const data = document.formData.sl3 ?? emptySl3();
  const items = orderedSl3Components(data), figures = sl3FigureIds(data);
  const itemNumbers = new Map(items.map((item, index) => [item.id, index]));
  const children = new Set(items.map(item => item.parentId).filter(Boolean));
  const notesById = new Map(data.notes.map((note, index) => [note.id, index]));
  const depths = hierarchyDepths(items);
  const notes = [...data.notes];
  if (data.sequencingNote) notes.push({ id: 'sequence', text: data.sequencingNote, portionMarking: data.sequencingPortion });
  if (data.showFigureReference || data.showModel) notes.push({ id: 'columns', text: `Inventory columns are renumbered to include ${[data.showFigureReference ? 'Figure Key / Reference Designator' : '', data.showModel ? 'Model Number' : ''].filter(Boolean).join(' and ')}. Fielding Plan: ${/[.!?]$/.test(data.fieldingPlanReference.trim()) ? data.fieldingPlanReference.trim() : data.fieldingPlanReference.trim() + '.'}`, portionMarking: data.technicalPortion });
  const sections = [['PREFACE', 'sl3.preface'], ['SPECIAL NOTES', 'sl3.notes'], ['ABBREVIATIONS', 'sl3.abbreviations'], ['TECHNICAL DATA', 'sl3.technical'], ['COMPONENTS INVENTORY', 'sl3.inventory'], ['INVENTORIED BY', 'sl3.certification']];
  word.registerTargets([
    ...sections.map(([label, destination], index) => ({ name: `PUBREF_SL3_SECTION_${index}`, label, destination })),
    ...SL3_PREFACE.filter(paragraph => !paragraph.note).map((_, index) => ({ name: `PUBREF_SL3_PREFACE_${index + 1}`, label: String(index + 1), destination: `sl3.preface.${index + 1}` })),
    ...notes.map((_, index) => ({ name: `PUBREF_SL3_NOTE_${index}`, label: String(index + 19), destination: `sl3.note.${index}` })),
    ...figures.map((_, index) => ({ name: `PUBREF_SL3_FIGURE_${index}`, label: `Figure ${index + 1}`, destination: `sl3.figure.${index + 1}` })),
    ...items.flatMap((item, index) => item.figureId ? [{ name: `PUBREF_SL3_ITEM_${index}`, label: String(index + 1), destination: `sl3.figure.${figures.indexOf(item.figureId) + 1}` }] : []),
  ]);
  word.heading('TABLE OF CONTENTS');
  // Some Word-compatible renderers ignore Roman numbering on PAGEREF fields.
  word.navigation('AUTHENTICATION', 'itype.authentication', 'link-only');
  for (const [index, [label, destination]] of sections.entries()) word.navigation(label, destination, index < 4 ? 'link-only' : 'decimal');
  if (figures.length) {
    word.heading('LIST OF ILLUSTRATIONS', 1, { newPage: true });
    for (const [index, id] of figures.entries()) word.navigation(`Figure ${index + 1}. ${figureParagraph(document, id).text}`, `sl3.figure.${index + 1}`);
  }
  word.heading('LIST OF TABLES'); word.navigation('Table 1. Components Inventory', 'sl3.inventory');
  word.heading('PREFACE', 1, { newPage: true, destination: 'sl3.preface' });
  let number = 0;
  for (let index = 0; index < SL3_PREFACE.length; index++) {
    const paragraph = SL3_PREFACE[index];
    if (paragraph.note) { word.text(`NOTE: ${marker(document)}${paragraph.text}`, { keep: true }); continue; }
    const note = SL3_PREFACE[index + 1];
    if (note?.note) { word.text(`NOTE: ${marker(document)}${note.text}`, { keep: true }); index++; }
    word.anchor(`sl3.preface.${++number}`);
    word.text(`${number}. ${marker(document)}${paragraph.text}`);
  }
  word.heading('18. SPECIAL NOTES', 1, { destination: 'sl3.notes' });
  if (!notes.length) word.text('None.');
  for (const [index, note] of notes.entries()) { word.anchor(`sl3.note.${index}`); word.text(`${index + 19}. ${marker(document, note.portionMarking)}${note.text}`); }
  word.heading('ABBREVIATIONS', 1, { newPage: true, destination: 'sl3.abbreviations' });
  word.table(['Term', 'Meaning'], sl3Definitions(data.definitions).map(definition => [marker(document, definition.portionMarking) + definition.term, definition.meaning]), [2400, 7680]);
  word.heading('TECHNICAL DATA', 1, { newPage: true, destination: 'sl3.technical' });
  for (const line of [`Source technical manual: ${data.sourceManual}`, data.configurationReference ? `Configuration source: ${data.configurationReference}` : '', data.technicalData]) if (line) word.text(marker(document, data.technicalPortion) + line);
  word.endSection({ ...section, numbering: 'lowerRoman', start: 2 });
  const geometry = sl3InventoryGeometry(data);
  // The PDF's narrow optional columns use line-breaking control unavailable
  // in Word. Preserve every inventory writing cell and the total grid width;
  // take the readable identifier width from the two flexible prose columns.
  const inventoryWidths = geometry.widths.map(width => Math.round(width * 20));
  let extraWidth = 0;
  for (let index = 18; index < inventoryWidths.length; index++) {
    const increase = Math.max(0, 1152 - inventoryWidths[index]);
    inventoryWidths[index] += increase; extraWidth += increase;
  }
  for (const [index, minimum] of [[17, 1440], [2, 1920]]) {
    const amount = Math.min(extraWidth, Math.max(0, inventoryWidths[index] - minimum));
    inventoryWidths[index] -= amount; extraWidth -= amount;
  }
  if (extraWidth) throw new Error('The optional inventory columns do not fit the Word writing grid. Export PDF or remove an optional column.');
  const inventory: SectionFormat = { ...section, start: 1, headerDetail: `END ITEM NOMENCLATURE: ${document.formData.nomenclature ?? ''}    SERIAL NUMBER: __________`, page: { width: geometry.pageWidth, height: 792, left: geometry.left, right: geometry.right } };
  word.heading('Table 1. Components Inventory', 1, { destination: 'sl3.inventory' });
  const headers = ['Item No.', 'NSN', 'Item Identification', 'U/M', 'Qty in Unit', 'Periodic Inventory\n(See paragraph {{PUBREF_SL3_PREFACE_8}} in Preface.)', ...Array.from({ length: 11 }, () => ''), 'Using Unit Remarks', ...(data.showFigureReference ? ['Fig Key / Ref Des'] : []), ...(data.showModel ? ['Model Number'] : [])];
  for (const [category, label] of Object.entries(SL3_CATEGORIES)) {
    const categoryItems = items.filter(item => item.category === category);
    if (!categoryItems.length && category === 'collateral') continue;
    word.heading(label.toUpperCase(), 2);
    if (!categoryItems.length) { word.text('None.'); continue; }
    word.table(headers, categoryItems.map(item => {
      const index = itemNumbers.get(item.id)!, depth = depths.get(item.id) ?? 0;
      const notes = item.noteIds.flatMap(id => notesById.has(id) ? [notesById.get(id)!] : []);
      const identification = `${'  '.repeat(depth)}${marker(document, item.portionMarking)}${depth ? `${item.quantity} - ` : ''}${item.nomenclature}${item.description ? `: ${item.description}` : ''}`
        + (notes.length ? `; See Special Notes ${notes.map(index => `{{PUBREF_SL3_NOTE_${index}}}`).join(', ')}` : '')
        + [item.partNumber ? `PN ${item.partNumber}` : '', item.cage ? `CAGE ${item.cage}` : '', `U/I ${item.unitOfIssue}`, item.tamcn ? `TAMCN ${item.tamcn}` : '', item.idNumber ? `ID ${item.idNumber}` : '', item.primaryTamcn ? `Primary TAMCN ${item.primaryTamcn}; ratio ${item.configurationRatio}` : '', children.has(item.id) ? 'c/o' : ''].filter(Boolean).map(value => `; ${value}`).join('');
      return [item.figureId ? `{{PUBREF_SL3_ITEM_${index}}}` : String(index + 1), item.nsn, identification, item.unit, depth ? '' : item.quantity, ...Array.from({ length: 12 }, () => ''), item.serialized ? '*Serial No.' : '', ...(data.showFigureReference ? [item.figureReference] : []), ...(data.showModel ? [item.model] : [])];
    }), inventoryWidths, { size: 9, headerSpans: [{ column: 5, span: 12 }] });
    word.text('Inventory Legend: C = Complete   I = Incomplete   S = Serviceable   U = Unserviceable   M = Missing');
  }
  await stockFigures(word, document, ports, figures, 'sl3');
  const notShown = items.flatMap((item, index) => item.figureId ? [] : [String(index + 1)]);
  if (notShown.length) word.text(`Not Shown — item numbers: ${notShown.join(', ')}`);
  word.heading('INVENTORIED BY', 1, { newPage: true, destination: 'sl3.certification' });
  const certification = SL3_CERTIFICATION_LAYOUT[data.orientation];
  word.table(['INVENTORIED BY\n(Signature of person conducting inventory)', 'SUPERVISED BY\n(Signature of person certifying/supervising inventory)', 'DATE\n(Date inventory completed)'], Array.from({ length: certification.rows }, () => ['', '', '']), weights([certification.grid[0], certification.grid[2], certification.grid[4]], Math.round((geometry.pageWidth - geometry.left - geometry.right) * 20)), { minimumRowHeight: certification.rowHeight / 20 });
  return inventory;
}

export async function sl4Body(word: PublicationWordPackage, document: PublicationWordSource, ports: PublicationWordPorts, section: SectionFormat): Promise<SectionFormat> {
  const data = document.formData.sl4 ?? emptySl4(), parts = numberedSl4Parts(data.rows), figures = sl4FigureIds(data);
  const indexes = buildSl4Indexes(data), numbered = new Map(parts.map(part => [part.id, part.itemNumber]));
  const depths = hierarchyDepths(parts), children = new Set(parts.map(part => part.parentId).filter(Boolean));
  const sections = ['RECORD OF CHANGES', 'PREFACE', 'ABBREVIATIONS', 'COMMERCIAL AND GOVERNMENT ENTITIES', 'PART I — ITEM IDENTIFICATION LISTING', 'PART II — ITEM NUMBER CROSS-REFERENCE', 'PART III — NATIONAL STOCK NUMBER CROSS-REFERENCE', 'PART IV — PART NUMBER CROSS-REFERENCE', ...(data.circuitIndex.mode === 'include' ? ['PART V — CIRCUIT SYMBOL NUMBER TO ITEM NUMBER CROSS-REFERENCE'] : [])];
  word.registerTargets([
    ...sections.map((label, index) => ({ name: `PUBREF_SL4_SECTION_${index}`, label, destination: `sl4.section.${index}` })),
    ...parts.map(part => ({ name: `PUBREF_SL4_ITEM_${part.itemNumber}`, label: String(part.itemNumber), destination: `sl4.item.${part.id}` })),
    ...figures.map((_, index) => ({ name: `PUBREF_SL4_FIGURE_${index}`, label: `Figure ${index + 1}`, destination: `sl4.figure.${index + 1}` })),
    ...parts.flatMap(part => part.figureId ? [{ name: `PUBREF_SL4_ITEM_FIGURE_${part.itemNumber}`, label: String(part.itemNumber), destination: `sl4.figure.${figures.indexOf(part.figureId) + 1}` }] : []),
  ]);
  word.heading('TABLE OF CONTENTS');
  word.navigation('AUTHENTICATION', 'itype.authentication', 'link-only');
  for (const [index, label] of sections.entries()) word.navigation(label, `sl4.section.${index}`, index < 4 ? 'link-only' : 'decimal');
  word.heading(sections[0], 1, { newPage: true, destination: 'sl4.section.0' });
  word.table(['Revision No.', 'Date', 'Title or Brief Description', 'Entered By'], data.revisions.length ? data.revisions.map(revision => [revision.revision, sl4LongDate(revision.date), marker(document, revision.portionMarking) + revision.description, revision.enteredBy]) : Array.from({ length: 6 }, () => ['', '', '', '']), weights(SL4_TABLE_GRIDS.revisions, 10080));
  word.heading('PREFACE', 1, { newPage: true, destination: 'sl4.section.1' });
  for (const block of SL4_PREFACE) {
    if (!block.number && block.text === 'PREFACE') continue;
    if (!block.number) word.heading(block.text, 2);
    else word.text(`${sl4PrefaceNumber(block.number)}  ${marker(document, block.number === '1' ? data.contextPortion : 'U')}${sl4PrefaceText(block.text, data.cutoffDate, document.formData.shortTitle ?? '')}`);
  }
  word.heading('SPECIAL NOTES', 2);
  if (!data.notes.length) word.text('21. None.');
  for (const [index, note] of data.notes.entries()) word.text(`${index + 21}. ${marker(document, note.portionMarking)}${note.text}`);
  if (data.circuitIndex.mode === 'omitted_excessive') word.text(`${marker(document, data.contextPortion)}Part V omitted: ${data.circuitIndex.reason}`);
  word.text(`${marker(document, data.contextPortion)}Source technical manual: ${data.sourceManual}`);
  if (data.standaloneRationale) word.text(`${marker(document, data.contextPortion)}Standalone rationale: ${data.standaloneRationale}`);
  word.heading('ABBREVIATIONS', 1, { newPage: true, destination: 'sl4.section.2' });
  word.table(['Term', 'Meaning'], sl4Definitions(data.definitions).map(definition => [marker(document, definition.portionMarking) + definition.term, definition.meaning]), [2400, 7680]);
  word.heading('COMMERCIAL AND GOVERNMENT ENTITIES', 1, { newPage: true, destination: 'sl4.section.3' });
  word.table(['CAGE', 'Entity', 'Address'], data.cages.map(cage => [cage.code, marker(document, cage.portionMarking) + cage.name, cage.address]), [1200, 3800, 5080]);
  if (figures.length) { word.heading('LIST OF ILLUSTRATIONS', 1, { newPage: true }); for (const [index, id] of figures.entries()) word.navigation(`Figure ${index + 1}. ${figureParagraph(document, id).text}`, `sl4.figure.${index + 1}`); }
  word.heading('LIST OF TABLES');
  for (let index = 4; index < sections.length; index++) word.navigation(`Table ${index - 3}. ${sections[index]}`, `sl4.section.${index}`);
  word.endSection({ ...section, numbering: 'lowerRoman', start: 2 });
  const partMargin = (792 - SL4_TABLE_GRIDS.partI.reduce((sum, width) => sum + width / 20, 0) - 0.75) / 2;
  const landscape: SectionFormat = { ...section, start: 1, page: { width: 792, height: 792, left: partMargin, right: partMargin } };
  word.heading(sections[4], 1, { destination: 'sl4.section.4' });
  const headers = ['1\nITEM NO.', '2\nSMR', '3\nNSN', '4\nCAGE', '5\nPART NUMBER', '6\nITEM IDENTIFICATION', '7\nREPL', '', '8\nU/M', '9\nQTY', ''];
  const subheaders = ['', '', '', '', '', '', '(a)\nMAN', '(b)\nECO', '', '(a)\nPER APPL', '(b)\nPER EQUIP'];
  let rows: string[][] = [], targets: string[] = [];
  const flush = () => {
    if (!rows.length) return;
    word.table(headers, [subheaders, ...rows], SL4_TABLE_GRIDS.partI, { size: 9, headerRows: 2, headerSpans: [{ column: 6, span: 2 }, { column: 9, span: 2 }], rowDestinations: ['', ...targets] });
    rows = []; targets = [];
  };
  for (const row of data.rows) {
    if (row.kind === 'heading') { flush(); word.heading(marker(document, row.portionMarking) + row.text, 2); continue; }
    if (row.kind === 'blank') { rows.push(Array.from({ length: 11 }, () => '')); targets.push(''); continue; }
    const depth = depths.get(row.id) ?? 0;
    const relationship = row.relationship ? `${row.relationship.kind === 'same_as' ? 'S/A' : row.relationship.kind === 'fabricated_from' ? 'FAB FR' : 'ASSEM FR'} ${row.relationship.itemIds.map(id => {
      const number = numbered.get(id);
      if (number === undefined) throw new Error('A stock publication item reference has no target.');
      return `{{PUBREF_SL4_ITEM_${number}}}`;
    }).join(', ')}` : '';
    const description = `${'  '.repeat(depth)}${marker(document, row.portionMarking)}${row.nomenclature}${row.description ? `: ${row.description}` : ''}${relationship ? `; ${relationship}` : ''}${row.circuitSymbols.length ? `; ${row.circuitSymbols.join(', ')}` : ''}${children.has(row.id) ? '; c/o' : ''}`;
    rows.push([row.figureId ? `{{PUBREF_SL4_ITEM_FIGURE_${numbered.get(row.id)}}}` : String(numbered.get(row.id)), row.smr, row.nsn, row.cage, row.partNumber, description, row.mandatoryReplacement ? 'X' : '', row.economicReplacement ? 'X' : '', row.unit, row.quantityPerApplication, row.quantityPerEquipment]);
    targets.push(`sl4.item.${row.id}`);
  }
  flush();
  await stockFigures(word, document, ports, figures, 'sl4');
  word.endSection(landscape);
  const indexTables: { title: string; headers: string[]; rows: string[][] }[] = [
    { title: sections[5], headers: ['Item No.', 'Part Number', 'CAGE'], rows: indexes.partII.map(row => [`{{PUBREF_SL4_ITEM_${row.itemNumber}}}`, marker(document, row.portionMarking) + row.partNumber, row.cage]) },
    { title: sections[6], headers: ['NSN', 'Item No.', 'CAGE', 'Part Number'], rows: indexes.partIII.map(row => [marker(document, row.portionMarking) + row.nsn, `{{PUBREF_SL4_ITEM_${row.itemNumber}}}`, row.cage, row.partNumber]) },
    { title: sections[7], headers: ['Part Number', 'CAGE', 'Item No.', 'NSN'], rows: indexes.partIV.map(row => [marker(document, row.portionMarking) + row.partNumber, row.cage, `{{PUBREF_SL4_ITEM_${row.itemNumber}}}`, row.nsn]) },
    ...(data.circuitIndex.mode === 'include' ? [{ title: sections[8], headers: ['Circuit Symbol', 'Item No.'], rows: indexes.partV.map(row => [marker(document, row.portionMarking) + row.circuitSymbol, `{{PUBREF_SL4_ITEM_${row.itemNumber}}}`]) }] : []),
  ];
  for (const [index, table] of indexTables.entries()) {
    word.heading(table.title, 1, { newPage: index > 0, destination: `sl4.section.${index + 5}` });
    if (!table.rows.length) word.text('None.');
    else word.table(table.headers, table.rows, weights(table.headers.map(() => 1), 10080));
  }
  return { ...section };
}
