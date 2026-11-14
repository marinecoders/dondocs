import type { Paragraph } from '@/types/document';

/** Formats pdfTeX places directly: raster images, and a PDF page for a vector
 *  drawing as a CAD export or a scanned sheet arrives. */
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };

export const figureExtension = (mime: string | undefined, name: string | undefined): string =>
  EXTENSIONS[mime ?? ''] ?? (/\.jpe?g$/i.test(name ?? '') ? 'jpg' : /\.pdf$/i.test(name ?? '') ? 'pdf' : 'png');

/** The file a figure is placed from, by its number in the document. */
export const figureFile = (n: number, mime?: string, name?: string, id?: string): string =>
  `attachments/figure-${n}${id ? '-' + Array.from(id).map((c) => c.codePointAt(0)!.toString(16).padStart(6, '0')).join('') : ''}.${figureExtension(mime, name)}`;

/** Business letters also accept request attachment IDs, which can exceed a
 * native filename after hex expansion. Keep ordinary cache identities intact
 * and encode longer IDs reversibly, without truncation or digest collisions. */
export function businessFigureFile(n: number, mime?: string, name?: string, id?: string): string {
  if (mime && !['image/png', 'image/jpeg', 'application/pdf'].includes(mime)) throw new Error('Business-letter figures require PNG or JPEG images.');
  if (id !== undefined) {
    try { encodeURIComponent(id); } catch { throw new Error('Business-letter PDF figure IDs must contain valid Unicode.'); }
  }
  const existing = figureFile(n, mime, name, id);
  if (existing.length <= 240) return existing;
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let value = 0, bits = 0, encoded = '';
  for (const byte of new TextEncoder().encode(id)) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; encoded += alphabet[(value >>> bits) & 31]; }
    value &= (1 << bits) - 1;
  }
  if (bits) encoded += alphabet[(value << (5 - bits)) & 31];
  const path = `attachments/figure-${n}-x${encoded}.${figureExtension(mime, name)}`;
  if (path.length > 240) throw new Error('Use a shorter business-letter PDF figure attachment ID.');
  return path;
}

/** A figure prints at text width, or narrower when its height would pass 5in. */
const PRINT_WIDTH_IN = 6.5;
const PRINT_HEIGHT_IN = 5;
/** Below this an image prints visibly soft; line art and photographs alike. */
const MIN_DPI = 150;

export function printedDpi(width: number, height: number, maxWidth = PRINT_WIDTH_IN, maxHeight = PRINT_HEIGHT_IN): number {
  const printedWidth = Math.min(maxWidth, maxHeight * (width / height));
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
