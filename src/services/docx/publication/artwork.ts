import { documentFontName } from '../../fonts';

export interface ArtworkLabel { text: string; x: number; y: number }
interface Extent { width: number; height: number }

export function artworkLabelPosition(label: ArtworkLabel, image: Extent, metrics: { width: number; ascent: number; descent: number }) {
  // Match slThreeArtworkLabel: tenths of a percent, centered horizontally,
  // with a text baseline measured upward from the image's bottom edge.
  const x = image.width * Math.round(label.x * 10) / 1000;
  const y = image.height * (1 - Math.round(label.y * 10) / 1000);
  if (![x, y, metrics.width, metrics.ascent, metrics.descent].every(Number.isFinite)
    || x - metrics.width / 2 < 0 || x + metrics.width / 2 > image.width
    || y - metrics.ascent < 0 || y + metrics.descent > image.height) {
    throw new Error(`Artwork label “${label.text}” crosses an image edge. Move or shorten it before Word export.`);
  }
  return { x, y };
}

/** Keep the source artwork and editable labels in the draft; flatten only the
 * Word derivative. Text is nine points, matching the stock publication profile.
 */
export async function flattenPublicationArtwork(bytes: Uint8Array, extent: Extent, labels: readonly ArtworkLabel[], signal: AbortSignal): Promise<Uint8Array> {
  const check = () => { if (signal.aborted) throw new Error('Export cancelled.'); };
  check();
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') throw new Error('This browser cannot prepare labelled Word artwork. Use a browser with image and canvas support or export PDF.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(extent.width * 2); canvas.height = Math.ceil(extent.height * 2);
  const context = canvas.getContext('2d');
  if (!context) { canvas.width = 0; canvas.height = 0; throw new Error('The browser could not prepare labelled Word artwork.'); }
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
    check();
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    context.font = `18px "${documentFontName('times')}", serif`;
    context.fillStyle = 'black'; context.textAlign = 'center'; context.textBaseline = 'alphabetic';
    for (const label of labels) {
      check();
      const measured = context.measureText(label.text);
      const position = artworkLabelPosition(label, canvas, { width: measured.width, ascent: measured.actualBoundingBoxAscent, descent: measured.actualBoundingBoxDescent });
      context.fillText(label.text, position.x, position.y);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Labelled Word artwork could not be saved.')), 'image/png'));
    check();
    const output = new Uint8Array(await blob.arrayBuffer());
    check();
    return output;
  } finally { bitmap?.close(); canvas.width = 0; canvas.height = 0; }
}
