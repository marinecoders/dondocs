import type { Paragraph } from '@/types/document';

/** Formats pdfTeX places directly: raster images, and a PDF page for a vector
 *  drawing as a CAD export or a scanned sheet arrives. */
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };

export const figureExtension = (mime: string | undefined, name: string | undefined): string =>
  EXTENSIONS[mime ?? ''] ?? (/\.jpe?g$/i.test(name ?? '') ? 'jpg' : /\.pdf$/i.test(name ?? '') ? 'pdf' : 'png');

/** The file a figure is placed from, by its number in the document. */
export const figureFile = (n: number, mime?: string, name?: string): string =>
  `attachments/figure-${n}.${figureExtension(mime, name)}`;

/** A figure prints at text width, or narrower when its height would pass 5in. */
const PRINT_WIDTH_IN = 6.5;
const PRINT_HEIGHT_IN = 5;
/** Below this an image prints visibly soft; line art and photographs alike. */
const MIN_DPI = 150;

export function printedDpi(width: number, height: number): number {
  const printedWidth = Math.min(PRINT_WIDTH_IN, PRINT_HEIGHT_IN * (width / height));
  return width / printedWidth;
}

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
    if (!p.figure.fileRef) findings.push({ severity: 'warning', message: `Figure ${n} has no image. Choose a PNG, JPEG, or PDF for it.` });
    if (!p.text.trim()) findings.push({ severity: 'warning', message: `Figure ${n} has no title. Its text is the title that prints under it.` });
    if (p.figure.width && p.figure.height) {
      const dpi = Math.round(printedDpi(p.figure.width, p.figure.height));
      if (dpi < MIN_DPI) findings.push({ severity: 'warning', message: `Figure ${n}'s image is ${p.figure.width} by ${p.figure.height} pixels and prints at about ${dpi} dpi; it will look soft. Use a larger image.` });
    }
  }
  return findings;
}
