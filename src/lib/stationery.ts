import { documentOutputConfig } from './documentOutputConfig';
import { resolveParagraphLayout } from '@/services/latex/paragraphLayout';
import { calculateLabels } from '@/services/latex/paragraphLabels';
import { ancestorLabelsPerParagraph } from '@/services/latex/subparagraphIndent';
import type { DocumentData, DocumentMode, Paragraph } from '@/types/document';

export type StationerySize = 'letter' | '7x9' | '5x7';
export interface StationeryGeometry { size: StationerySize; width: number; height: number; textWidth: number; textHeight: number; small: boolean }
/** Figures 12-7/12-8 specify stock sizes; retain conservative 1-inch margins. */
export function correspondenceStationery(docType: string | undefined, data: Pick<Partial<DocumentData>, 'stationerySize'>): StationeryGeometry {
  const size = docType === 'executive_correspondence' && (data.stationerySize === '7x9' || data.stationerySize === '5x7') ? data.stationerySize : 'letter';
  const [width, height] = size === '7x9' ? [7, 9] : size === '5x7' ? [5, 7] : [8.5, 11];
  return { size, width, height, textWidth: width - 2, textHeight: height - 2, small: size !== 'letter' };
}
export function stationeryIssues(docType: string, data: Partial<DocumentData>, paragraphs: readonly Paragraph[] = [], mode?: DocumentMode): string[] {
  const stock = correspondenceStationery(docType, data);
  if (!stock.small) return [];
  const issues: string[] = [];
  if (data.letterheadMode !== 'preprinted' && data.letterheadMode !== 'title-only') issues.push('Small executive stationery supports preprinted or title-only letterhead. Choose one before exporting.');
  if (data.classLevel === 'custom') issues.push('Custom classification banners require US Letter stock. Choose Letter or a standard classification.');
  if (data.fontFamily && data.fontFamily !== 'times' || data.fontSize && data.fontSize !== '12pt') issues.push('Small executive stationery requires 12pt Times New Roman.');
  const config = documentOutputConfig(docType, mode);
  const labels = calculateLabels([...paragraphs]);
  const ancestors = ancestorLabelsPerParagraph(labels, paragraphs.map(paragraph => paragraph.level));
  paragraphs.forEach((paragraph, index) => {
    if (paragraph.figure || paragraph.bodyTable) return;
    const layout = resolveParagraphLayout(paragraph.level, ancestors[index], config, 'times', 12);
    if (stock.textWidth - Math.max(layout.firstLineIndentIn, layout.continuationIndentIn) < 1) {
      issues.push(`Paragraph ${index + 1} is too deeply indented for ${stock.size} stationery. Outdent it or choose larger stock; leave at least 1 inch for body text.`);
    }
  });
  return issues;
}
export function assertStationerySupport(docType: string, data: Partial<DocumentData>, paragraphs: readonly Paragraph[] = [], mode?: DocumentMode): void {
  const issues = stationeryIssues(docType, data, paragraphs, mode);
  if (issues.length) throw new Error(issues.join(' '));
}
