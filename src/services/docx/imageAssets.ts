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
export const docxFigureFile = (number: number, type?: string, name?: string) => `figure-${number}.${figureExtension(type, name)}`;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

function pngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24 || bytes[0] !== 137 || String.fromCharCode(...bytes.slice(1, 4)) !== 'PNG') throw new Error('The image is not a valid PNG.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error('The image exceeds the 40 megapixel Word limit.');
  return { width, height };
}
function boundedImage(bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Word images must be smaller than 10 MB.');
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
    try { await (await PDFDocument.create()).embedPng(bytes); }
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
      boundedImage(bytes);
      if (!/\.jpg$/.test(file)) pngDimensions(bytes);
    } catch (error) { throw new Error(`Figure ${number}: ${error instanceof Error ? error.message : 'The image cannot be read.'}`); }
    try {
      const pdf = await PDFDocument.create();
      const image = /\.jpg$/.test(file) ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      if (image.width * image.height > MAX_IMAGE_PIXELS) throw new Error('Image exceeds the 40 megapixel Word limit.');
      paragraph.figure = { ...figure, width: image.width, height: image.height };
    } catch { throw new Error(`Figure ${number} cannot be read. Choose a valid PNG or JPEG before exporting Word.`); }
    files[file] = bytes;
  }
  return files;
}
