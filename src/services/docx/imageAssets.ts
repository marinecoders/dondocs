import { PDFDocument } from 'pdf-lib';
import { DOC_TYPE_CONFIG, type DocumentData, type Paragraph } from '@/types/document';
import { base64ToUint8Array, uint8ArrayToBase64 } from '@/lib/encoding';
import { figureExtension } from '@/lib/figures';

export interface DocxImageSource {
  docType: string;
  formData: Partial<DocumentData>;
  paragraphs: Paragraph[];
}
export type DocxMedia = Readonly<Record<string, Uint8Array>>;

/** Safe, actionable input errors may cross the companion HTTP boundary. */
export class ImageInputError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'ImageInputError'; }
}

/** These correspondence templates draw the shared signature PNG. Information
 * memoranda, dual-signer layouts and publications retain it only as draft data. */
export function supportsCorrespondenceSignatureImage(docType: string): boolean {
  return Object.hasOwn(DOC_TYPE_CONFIG, docType) && DOC_TYPE_CONFIG[docType].signature !== 'dual'
    && !['information_memorandum', 'i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'].includes(docType);
}
/** A conversion owns a fresh input filesystem, so the ordinal is sufficient
 * and keeps opaque attachment IDs out of native filenames. */
export function docxFigureFile(number: number, type?: string, name?: string) {
  if (type && !['image/png', 'image/jpeg', 'application/pdf'].includes(type)) throw new ImageInputError('Figures require PNG or JPEG images.');
  return `figure-${number}.${figureExtension(type, name)}`;
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const pngCrcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function pngCrc(bytes: Uint8Array, from: number, to: number) {
  let crc = 0xffffffff;
  for (let i = from; i < to; i++) crc = pngCrcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngDimensions(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((value, index) => bytes[index] !== value)) throw new ImageInputError('The image is not a valid PNG.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, header = false, data = false, ended = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (size > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/.test(type)) throw new ImageInputError('The PNG contains a malformed chunk.');
    if (!header && (type !== 'IHDR' || size !== 13)) throw new ImageInputError('The PNG must begin with one IHDR chunk.');
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new ImageInputError('Animated PNG images are not supported. Choose a static PNG.');
    if (pngCrc(bytes, offset + 4, offset + 8 + size) !== view.getUint32(offset + 8 + size)) throw new ImageInputError('The PNG contains a corrupt chunk checksum.');
    if (type === 'IHDR') {
      if (header || size !== 13) throw new ImageInputError('The PNG contains a duplicate or malformed IHDR chunk.');
      header = true;
      const depth = bytes[offset + 16], color = bytes[offset + 17];
      const depths: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) throw new ImageInputError('The PNG image header is invalid.');
    }
    if (type === 'IDAT') data = true;
    offset += size + 12;
    if (type === 'IEND') {
      if (size !== 0 || !data || offset !== bytes.length) throw new ImageInputError('The PNG image ending is invalid.');
      ended = true; break;
    }
  }
  if (!ended) throw new ImageInputError('The PNG is truncated or missing image data.');
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new ImageInputError('The image exceeds the 40 megapixel limit.');
  return { width, height };
}
function boundedImage(bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new ImageInputError('Images must be smaller than 10 MB.');
}

/** pdf-lib reads only JPEG frame dimensions. Check the complete segment/scan
 * structure too, so a header-only or truncated upload cannot become a broken
 * Word image. Entropy bytes remain owned by the actual image decoder. */
function validateJpeg(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) throw new ImageInputError('The image is not a valid JPEG.');
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2, frame = false, scan = false, entropy = false, inScan = false;
  while (offset < bytes.length) {
    if (inScan) {
      while (offset < bytes.length && bytes[offset] !== 0xff) { entropy = true; offset++; }
      if (offset === bytes.length) break;
    }
    if (bytes[offset++] !== 0xff) throw new ImageInputError('The JPEG contains a malformed marker.');
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset === bytes.length) break;
    const marker = bytes[offset++];
    if (inScan && (marker === 0 || marker >= 0xd0 && marker <= 0xd7)) {
      if (marker === 0) entropy = true;
      continue;
    }
    inScan = false;
    if (marker === 0xd9) {
      if (!frame || !scan || !entropy) throw new ImageInputError('The JPEG is missing image data.');
      return;
    }
    if (marker === 1) continue; // TEM is the other standalone marker.
    if (marker === 0 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7 || offset + 2 > bytes.length) throw new ImageInputError('The JPEG contains an invalid marker.');
    const size = view.getUint16(offset);
    if (size < 2 || size > bytes.length - offset) throw new ImageInputError('The JPEG contains a truncated or malformed segment.');
    if (frames.has(marker)) {
      if (frame || size < 8 || size !== 8 + bytes[offset + 7] * 3) throw new ImageInputError('The JPEG image frame is invalid.');
      const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5);
      if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new ImageInputError('The image exceeds the 40 megapixel limit or has invalid dimensions.');
      frame = true;
    }
    if (marker === 0xda) {
      if (!frame || size < 6 || !bytes[offset + 2] || size !== 6 + bytes[offset + 2] * 2) throw new ImageInputError('The JPEG image scan is invalid.');
      scan = true; inScan = true;
    }
    offset += size;
  }
  throw new ImageInputError('The JPEG is truncated or missing its ending.');
}

/** Inspect business-letter raster inputs before browser/PDF decoders allocate
 * image buffers. PNG structure is checked before its declared size is used. */
export async function inspectRasterImage(bytes: Uint8Array, type: 'image/png' | 'image/jpeg') {
  boundedImage(bytes);
  if (type === 'image/png') pngDimensions(bytes);
  else validateJpeg(bytes);
  const pdf = await PDFDocument.create();
  // JpegEmbedder reads the backing buffer rather than the view's byteOffset.
  // Own an exact buffer for pooled Node Buffers and sliced browser inputs.
  const owned = new Uint8Array(bytes);
  try {
    const image = type === 'image/jpeg' ? await pdf.embedJpg(owned) : await pdf.embedPng(owned);
    if (image.width * image.height > MAX_IMAGE_PIXELS) throw new ImageInputError('The image exceeds the 40 megapixel limit.');
    return { width: image.width, height: image.height };
  } catch (error) {
    if (error instanceof ImageInputError) throw error;
    throw new ImageInputError('The image cannot be read. Choose a valid PNG or JPEG.', { cause: error });
  }
}

export function imageExtent(width: number, height: number, maxWidth: number, maxHeight: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new ImageInputError('The image dimensions are invalid. Reattach the image before exporting.');
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

/** Signature uploads are normalized to PNG by the editor. Reading IHDR here
 * keeps the flat generator synchronous; preparation validates the whole PNG. */
export function signatureExtent(data: string) {
  const bytes = base64ToUint8Array(data.replace(/^data:image\/png;base64,/, ''));
  boundedImage(bytes);
  const { width, height } = pngDimensions(bytes);
  return imageExtent(width, height, 1.5, .5);
}

/** Resolve only the captured model's media. The caller owns the resource lease
 * for this operation, and preparation never consults the live editor. */
export async function prepareDocxImages(source: DocxImageSource, read: (id: string) => Promise<ArrayBuffer | Uint8Array>): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  if (source.formData.signatureType === 'image') {
    if (!supportsCorrespondenceSignatureImage(source.docType)) throw new ImageInputError('Word signature images require supported single-signer correspondence.');
    let image = source.formData.signatureImage;
    if (image && !image.data && image.fileRef) {
      let bytes: Uint8Array;
      try { bytes = new Uint8Array(await read(image.fileRef.id)); }
      catch { throw new ImageInputError('The signature image could not be read. Reattach it before exporting Word.'); }
      image = { ...image, data: uint8ArrayToBase64(bytes) };
      source.formData.signatureImage = image;
    }
    if (!image?.data) throw new ImageInputError('The signature image is missing. Reattach it before exporting Word.');
    const bytes = base64ToUint8Array(image.data.replace(/^data:image\/png;base64,/, ''));
    signatureExtent(image.data);
    try { await inspectRasterImage(bytes, 'image/png'); }
    catch { throw new ImageInputError('The signature image cannot be read. Reattach a valid PNG before exporting Word.'); }
    files['signature.png'] = bytes;
  }
  let number = 0;
  for (const paragraph of source.paragraphs) {
    const figure = paragraph.figure;
    if (!figure) continue;
    number++;
    if (source.docType !== 'business_letter') throw new ImageInputError('Word figures are supported in business letters. This document family does not support Word figures yet.');
    if (!figure.fileRef) throw new ImageInputError(`Figure ${number} has no image. Choose a PNG or JPEG before exporting Word.`);
    const file = docxFigureFile(number, figure.type, figure.name);
    if (/\.pdf$/i.test(file)) throw new ImageInputError(`Figure ${number} is a PDF. Choose a PNG or JPEG for Word export.`);
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await read(figure.fileRef.id)); }
    catch { throw new ImageInputError(`Figure ${number} could not be read. Reattach it before exporting Word.`); }
    try {
      const dimensions = await inspectRasterImage(bytes, /\.jpg$/.test(file) ? 'image/jpeg' : 'image/png');
      paragraph.figure = { ...figure, ...dimensions };
    } catch (error) { throw new ImageInputError(`Figure ${number}: ${error instanceof Error ? error.message : 'Choose a valid PNG or JPEG before exporting Word.'}`, { cause: error }); }
    files[file] = bytes;
  }
  return files;
}
