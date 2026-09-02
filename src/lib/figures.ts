import type { Paragraph } from '@/types/document';

/** Image formats pdfTeX places directly. */
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

export const figureExtension = (mime: string | undefined, name: string | undefined): string =>
  EXTENSIONS[mime ?? ''] ?? (/\.jpe?g$/i.test(name ?? '') ? 'jpg' : 'png');

/** The file a figure is placed from, by its number in the document. */
export const figureFile = (n: number, mime?: string, name?: string): string =>
  `attachments/figure-${n}.${figureExtension(mime, name)}`;

/**
 * A figure carries an image and a title ("Figure 1. Rail alignment"). Names
 * each figure that lacks either, by the number it will print. Advisory.
 */
export function validateFigures(paragraphs: Paragraph[]): { severity: 'warning'; message: string }[] {
  const findings: { severity: 'warning'; message: string }[] = [];
  let n = 0;
  for (const p of paragraphs) {
    if (!p.figure) continue;
    n++;
    if (!p.figure.fileRef) findings.push({ severity: 'warning', message: `Figure ${n} has no image. Choose a PNG or JPEG for it.` });
    if (!p.text.trim()) findings.push({ severity: 'warning', message: `Figure ${n} has no title. Its text is the title that prints under it.` });
  }
  return findings;
}
