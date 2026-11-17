import type { Paragraph } from '@/types/document';
import { figureExtension } from './figures';
import { assertRichBlockShape, bodyTableSchema } from './bodyTable';

/** Content checks run before a Word conversion acquires or decodes images. */
export function publicationWordExportErrors(document: { docType: string; paragraphs: readonly Paragraph[] }): string[] {
  if (!['tm_ietm_front_matter', 'i_type', 'sl3', 'sl4'].includes(document.docType)) return [];
  const errors: string[] = [];
  for (const [index, paragraph] of document.paragraphs.entries()) {
    try { assertRichBlockShape(paragraph); } catch (error) {
      errors.push(`Paragraph ${index + 1}: ${error instanceof Error ? error.message : 'Separate conflicting body blocks before Word export.'}`);
    }
    if (document.docType !== 'i_type' && (paragraph.bodyTable || paragraph.figure?.placement === 'body')) {
      errors.push('This publication profile does not contain general body tables or images. Use a document with a body before exporting this imported content.');
    }
    if (paragraph.bodyTable && !bodyTableSchema.safeParse(paragraph.bodyTable).success) errors.push(`Paragraph ${index + 1} contains an invalid Word body table.`);
    const figure = paragraph.figure;
    if (!figure) continue;
    if (figure.type === 'application/pdf' || figure.fileRef?.type === 'application/pdf' || figureExtension(figure.type, figure.name ?? figure.fileRef?.name) === 'pdf') {
      errors.push(`Figure ${index + 1}: Word publication figures require PNG or JPEG. Keep the original PDF separately or attach a raster copy.`);
    } else if (figure.type && !['image/png', 'image/jpeg'].includes(figure.type)) errors.push(`Figure ${index + 1}: Word publication figures require PNG or JPEG.`);
  }
  return [...new Set(errors)];
}
