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
/** A conversion owns a fresh input filesystem, so the ordinal is sufficient
 * and keeps opaque attachment IDs out of native filenames. */
export function docxFigureFile(number: number, type?: string, name?: string) {
  if (type && !['image/png', 'image/jpeg', 'application/pdf'].includes(type)) throw new Error('Figures require PNG or JPEG images.');
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
  if (bytes.length < 33 || signature.some((value, index) => bytes[index] !== value)) throw new Error('The image is not a valid PNG.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, header = false, data = false, ended = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (size > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/.test(type)) throw new Error('The PNG contains a malformed chunk.');
    if (!header && (type !== 'IHDR' || size !== 13)) throw new Error('The PNG must begin with one IHDR chunk.');
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('Animated PNG images are not supported. Choose a static PNG.');
    if (pngCrc(bytes, offset + 4, offset + 8 + size) !== view.getUint32(offset + 8 + size)) throw new Error('The PNG contains a corrupt chunk checksum.');
    if (type === 'IHDR') {
      if (header || size !== 13) throw new Error('The PNG contains a duplicate or malformed IHDR chunk.');
      header = true;
      const depth = bytes[offset + 16], color = bytes[offset + 17];
      const depths: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) throw new Error('The PNG image header is invalid.');
    }
    if (type === 'IDAT') data = true;
    offset += size + 12;
    if (type === 'IEND') {
      if (size !== 0 || !data || offset !== bytes.length) throw new Error('The PNG image ending is invalid.');
      ended = true; break;
    }
  }
  if (!ended) throw new Error('The PNG is truncated or missing image data.');
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error('The image exceeds the 40 megapixel limit.');
  return { width, height };
}
function boundedImage(bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Images must be smaller than 10 MB.');
}

/** Inspect business-letter raster inputs before browser/PDF decoders allocate
 * image buffers. PNG structure is checked before its declared size is used. */
export async function inspectRasterImage(bytes: Uint8Array, type: 'image/png' | 'image/jpeg') {
  boundedImage(bytes);
  if (type === 'image/png') pngDimensions(bytes);
  const pdf = await PDFDocument.create();
  const image = type === 'image/jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
  if (image.width * image.height > MAX_IMAGE_PIXELS) throw new Error('The image exceeds the 40 megapixel limit.');
  return { width: image.width, height: image.height };
}

export function imageExtent(width: number, height: number, maxWidth: number, maxHeight: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('The image dimensions are invalid. Reattach the image before exporting.');
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
    if (DOC_TYPE_CONFIG[source.docType]?.signature === 'dual' || source.docType === 'information_memorandum' || ['i_type', 'sl3', 'sl4', 'tm_ietm_front_matter'].includes(source.docType)) throw new Error('Word signature images require supported single-signer correspondence.');
    let image = source.formData.signatureImage;
    if (image && !image.data && image.fileRef) {
      let bytes: Uint8Array;
      try { bytes = new Uint8Array(await read(image.fileRef.id)); }
      catch { throw new Error('The signature image could not be read. Reattach it before exporting Word.'); }
      image = { ...image, data: uint8ArrayToBase64(bytes) };
      source.formData.signatureImage = image;
    }
    if (!image?.data) throw new Error('The signature image is missing. Reattach it before exporting Word.');
    const bytes = base64ToUint8Array(image.data.replace(/^data:image\/png;base64,/, ''));
    signatureExtent(image.data);
    try { await inspectRasterImage(bytes, 'image/png'); }
    catch { throw new Error('The signature image cannot be read. Reattach a valid PNG before exporting Word.'); }
    files['signature.png'] = bytes;
  }
  let number = 0;
  for (const paragraph of source.paragraphs) {
    const figure = paragraph.figure;
    if (!figure) continue;
    number++;
    if (source.docType !== 'business_letter') throw new Error('Word figures are supported in business letters. This document family does not support Word figures yet.');
    if (!figure.fileRef) throw new Error(`Figure ${number} has no image. Choose a PNG or JPEG before exporting Word.`);
    const file = docxFigureFile(number, figure.type, figure.name);
    if (/\.pdf$/i.test(file)) throw new Error(`Figure ${number} is a PDF. Choose a PNG or JPEG for Word export.`);
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await read(figure.fileRef.id)); }
    catch { throw new Error(`Figure ${number} could not be read. Reattach it before exporting Word.`); }
    try {
      const dimensions = await inspectRasterImage(bytes, /\.jpg$/.test(file) ? 'image/jpeg' : 'image/png');
      paragraph.figure = { ...figure, ...dimensions };
    } catch (error) { throw new Error(`Figure ${number}: ${error instanceof Error ? error.message : 'Choose a valid PNG or JPEG before exporting Word.'}`, { cause: error }); }
    files[file] = bytes;
  }
  return files;
}
