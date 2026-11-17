import type { Paragraph } from '@/types/document';
import { tableSpec } from '@/data/techpub/tables';
import { publicationTypeName } from '@/data/techpub/publicationTypes';
import { calculateLabels } from '@/services/latex/paragraphLabels';
import { isUnderlinedLevel } from '@/services/latex/paragraphLabel';
import { publicationReferences } from '@/lib/publicationReferences';
import { withTimeCompliance } from '@/lib/timeCompliance';
import { publicationDate } from '@/lib/timeCompliance';
import { iTypeDestructionNotice } from '@/lib/iTypeClassification';
import { format, isValid } from 'date-fns';
import { figureExtension } from '@/lib/figures';
import { bodyTableSchema } from '@/lib/bodyTable';
import { imageExtent, inspectRasterImage } from '../imageAssets';
import { PublicationWordPackage, type SectionFormat, type WordText, type WordTextRun } from './package';
import { authentication, endItemTable, publicationNotices } from './frontMatter';
import type { PublicationWordPorts, PublicationWordSource } from './index';
import { flattenPublicationArtwork, type ArtworkLabel } from './artwork';

const literal = (text: string): WordTextRun => ({ text, format: { inlineMode: 'literal' } });
const rich = (text: string): WordTextRun => ({ text, format: { inlineMode: 'rich' } });

/** Labels stay native runs: only the second-cycle counter is underlined;
 * its period/parentheses and any procedural special case stay unchanged.
 */
function labelRuns(label: string, level: number): WordTextRun[] {
  const part = (text: string, underline = false): WordTextRun => ({ text, format: { underline, inlineMode: 'literal' } });
  if (!isUnderlinedLevel(level)) return [part(label)];
  const start = label.startsWith('(') ? 1 : 0;
  const end = /[.)]$/.test(label) ? label.length - 1 : label.length;
  return [part(label.slice(0, start)), part(label.slice(start, end), true), part(label.slice(end))].filter(run => run.text);
}

/** Read and validate only bytes retained by the prepared source's asset lease. */
export async function publicationFigure(word: PublicationWordPackage, paragraph: Paragraph, ports: PublicationWordPorts, caption: WordText, labels: readonly ArtworkLabel[] = []): Promise<void> {
  const figure = paragraph.figure;
  if (!figure?.fileRef) throw new Error('Reattach the publication figure before Word export.');
  if (figure.type && !['image/png', 'image/jpeg', 'application/pdf'].includes(figure.type)) throw new Error('Word publication figures require PNG or JPEG.');
  const extension = figureExtension(figure.type, figure.name);
  if (extension !== 'png' && extension !== 'jpg') throw new Error('Word publication figures require PNG or JPEG. Keep the original PDF separately or attach a raster copy.');
  word.check();
  const record = ports.readAsset(figure.fileRef.id);
  const bytes = new Uint8Array(record.data);
  const dimensions = await inspectRasterImage(bytes, extension === 'jpg' ? 'image/jpeg' : 'image/png');
  word.check();
  const extent = imageExtent(dimensions.width, dimensions.height, 468, 360);
  const graphicMarking = figure.portionMarking ?? paragraph.portionMarking;
  if (graphicMarking) word.text(`(${graphicMarking})`, { align: 'center', keep: true });
  const output = labels.length ? await (ports.renderArtwork ?? flattenPublicationArtwork)(bytes, extent, labels, word.abortSignal) : bytes;
  word.check();
  const captionText = typeof caption === 'string' ? caption : caption.map(part => part.text).join('');
  word.image(output, labels.length ? 'png' : extension, extent.width, extent.height, figure.altText?.trim() || paragraph.text || captionText);
  if (captionText) word.text(caption, { align: 'center', bold: true, before: 4, after: 12, inlineMode: 'literal' });
}

export function instructionCover(word: PublicationWordPackage, document: PublicationWordSource, seal: Uint8Array, referenceDate: Date, section: SectionFormat): void {
  const data = document.formData;
  const issued = publicationDate(data.date ?? '', referenceDate);
  word.text(isValid(issued) ? format(issued, 'MMMM yyyy').toUpperCase() : data.date ?? '', { bold: true });
  word.text(data.shortTitle ?? '', { align: 'right', bold: true, size: 18 });
  word.text(`U.S. MARINE CORPS ${publicationTypeName(data.publicationType).toUpperCase()}`, { align: 'center', bold: true, size: 14 });
  word.text((data.subject ?? '').toUpperCase(), { style: 'Title', align: 'center', bold: true, size: 14 });
  if ((data.publicationType ?? 'MI') === 'MI') word.text((data.miUrgency ?? 'normal').toUpperCase(), { align: 'center', bold: true });
  word.text((data.nomenclature ?? '').toUpperCase(), { align: 'center', bold: true, size: 14 });
  word.image(seal, 'png', 120, 120, 'United States Marine Corps seal');
  if (document.endItems.length > 6) word.text('END ITEMS: See end-item continuation.', { align: 'center' });
  else endItemTable(word, document.endItems, 6);
  publicationNotices(word, data);
  // Distribution restrictions and classified/CUI material use distinct notices.
  const notice = iTypeDestructionNotice(data, document.paragraphs);
  if (notice) word.text(notice, { size: 8 });
  word.text(`PCN ${data.pcn ?? ''}`, { align: 'right', bold: true });
  word.endSection({ ...section, start: 1, cover: true });
  if (document.endItems.length > 6) {
    word.heading('END ITEM CONTINUATION'); endItemTable(word, document.endItems);
    word.endSection({ ...section });
  }
  authentication(word, data, referenceDate);
  for (const [index, paragraph] of document.paragraphs.filter(p => p.appendix).entries()) word.text(`${paragraph.portionMarking ? `(${paragraph.portionMarking}) ` : ''}Appendix ${String.fromCharCode(65 + index)}: ${paragraph.header ?? ''}`);
  for (const [index, enclosure] of (document.enclosures ?? []).entries()) word.text(`Enclosure (${index + 1}): ${enclosure.title}`);
  word.endSection({ ...section });
}

export async function instructionBody(word: PublicationWordPackage, document: PublicationWordSource, ports: PublicationWordPorts, section: SectionFormat): Promise<SectionFormat> {
  const paragraphs = (document.formData.publicationType ?? 'MI') === 'MI'
    ? withTimeCompliance(document.paragraphs, document.formData.miUrgency ?? 'normal', document.formData.miCompletionDate) : document.paragraphs;
  const targets = publicationReferences(paragraphs, document.publicationTables);
  word.registerTargets(targets);
  const labels = calculateLabels(paragraphs, true, false);
  let current: SectionFormat = { ...section };
  let appendix = 0, ended = false;
  for (const [index, paragraph] of paragraphs.entries()) {
    word.check();
    const marking = paragraph.portionMarking ? `(${paragraph.portionMarking}) ` : '';
    if (paragraph.bodyTable) {
      const table = bodyTableSchema.parse(paragraph.bodyTable);
      if (paragraph.header || paragraph.text || marking) word.text([literal(marking + (paragraph.header ?? '') + (paragraph.header && paragraph.text ? '. ' : '')), rich(paragraph.text)], { bold: true, keep: true });
      const widths = table.rows[0].map(() => Math.floor(10080 / table.rows[0].length));
      widths[widths.length - 1] += 10080 - widths.reduce((sum, width) => sum + width, 0);
      word.table(table.rows[0], table.rows.slice(1), widths, { headerRows: table.headerRows, inlineMode: 'rich' });
      continue;
    }
    if (paragraph.appendix) {
      if (!ended) { word.text('END OF INSTRUCTION', { bold: true, align: 'center', before: 12 }); ended = true; }
      word.endSection(current);
      const letter = String.fromCharCode(65 + appendix++);
      current = { ...section, prefix: `${letter}-`, start: 1 };
      word.anchor(`itype.p.${index}`);
      word.heading(`${marking}APPENDIX ${letter}: ${(paragraph.header ?? '').toUpperCase()}`);
      if (paragraph.text) word.text(marking + paragraph.text, { inlineMode: 'rich' });
      continue;
    }
    if (paragraph.figure) {
      word.anchor(`itype.figure.${index}`);
      const numbered = targets.find(target => target.index === index && target.kind === 'F');
      const header = paragraph.header?.trim().replace(/\.$/, '') ?? '';
      const bodyImage = paragraph.figure.placement === 'body';
      const prose = bodyImage ? paragraph.text : paragraph.text.replace(/\.$/, '');
      const prefix = bodyImage ? marking : `${marking}${numbered?.label.replace(/^figure/, 'Figure') ?? 'Figure'}. `;
      const leading = prefix + header + (header && prose ? '. ' : '');
      const caption = [literal(prose ? leading : leading.trimEnd()), rich(prose)];
      await publicationFigure(word, paragraph, ports, caption);
      continue;
    }
    if (paragraph.callout) {
      word.text(paragraph.callout.toUpperCase(), { align: 'center', bold: true, keep: true, before: 12 });
      word.text(marking + paragraph.text, { uppercase: paragraph.callout === 'warning', indent: 18, keep: paragraph.callout !== 'note', after: 12, inlineMode: 'rich' });
      continue;
    }
    word.anchor(`itype.p.${index}`);
    const indent = paragraph.procedure ? 18 + paragraph.level * 18 : 0;
    if (paragraph.header) word.heading([...labelRuns(labels[index], paragraph.level), literal(`  ${marking}${paragraph.header.replace(/\.$/, '')}`)], paragraph.level === 0 ? 1 : paragraph.level === 1 ? 2 : 3);
    if (paragraph.text) word.text([...(paragraph.header ? [] : [...labelRuns(labels[index], paragraph.level), literal('  ')]), literal(marking), rich(paragraph.text)], { indent, hanging: paragraph.procedure ? 18 : 0, after: 12 });
    if (paragraph.tableKey && document.publicationTables[paragraph.tableKey]?.length) {
      const spec = tableSpec(paragraph.tableKey, paragraph.tableIdentifierMode);
      if (!spec) throw new Error('This publication table is not supported in Word.');
      const rows = document.publicationTables[paragraph.tableKey];
      const columns = rows.some(row => row.values.item?.trim()) ? spec.columns : spec.columns.filter(column => column.key !== 'item');
      const total = columns.reduce((sum, column) => sum + parseFloat(column.width), 0);
      // Word's cell gutters need a half-inch writing column to retain "Item"
      // on one line. Take the small adjustment from the widest prose column.
      const widths = columns.map(column => Math.max(720, Math.round(10080 * parseFloat(column.width) / total)));
      const widest = widths.reduce((best, width, index) => width > widths[best] ? index : best, 0);
      widths[widest] += 10080 - widths.reduce((sum, width) => sum + width, 0);
      word.anchor(`itype.table.${index}`);
      word.text(`${targets.find(target => target.index === index && target.kind === 'T')?.label.replace(/^table/, 'Table') ?? 'Table'}. ${paragraph.header ?? spec.name}`, { bold: true, align: 'center', keep: true });
      word.table(columns.map(column => column.label), rows.map(row => columns.map(column => column.key === 'description'
        ? `${'  '.repeat(Math.min(row.level ?? 0, 2))}${[row.values[column.key], row.identificationException, row.openPurchase?.manufacturer, row.openPurchase?.address].filter(Boolean).join('\n')}` : row.values[column.key] ?? '')), widths);
      for (const note of paragraph.tableFootnotes ?? []) { word.anchor(`itype.note.${index}.${note.id.toUpperCase()}`); word.text(`${note.id}  ${note.text}`, { inlineMode: 'rich' }); }
    }
  }
  if (!ended && paragraphs.length) word.text('END OF INSTRUCTION', { align: 'center', bold: true, before: 12 });
  return current;
}
