import { decodePDFRawStream, degrees, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { identifyOfficialOriginal } from '@/services/forms/nativeCatalog';
import { preflightPng } from '@/services/pdf/accessibility/raster';
import { MAX_SIGNING_PDF_BYTES, inspectSigningPdf, manualSignatureSchema, signaturePdfRectangle, type ManualSignature } from './manualSignatureFields';
import { MAX_SIGNATURE_GRAPHIC_BYTES } from './signatureGraphic';

/** Keep image samples and their palette/transparency. Drop ancillary file metadata. */
export function portableSignatureGraphic(graphic: string): string {
  if (!graphic.length || graphic.length > Math.ceil(MAX_SIGNATURE_GRAPHIC_BYTES / 3) * 4) throw new Error('Choose a signature PNG up to 2 MB.');
  const bytes = base64ToUint8Array(graphic);
  if (bytes.length > MAX_SIGNATURE_GRAPHIC_BYTES) throw new Error('Choose a signature PNG up to 2 MB.');
  preflightPng(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 8)];
  for (let at = 8; at < bytes.length;) {
    const end = at + 12 + view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (['IHDR', 'PLTE', 'IDAT', 'tRNS', 'IEND'].includes(type)) parts.push(bytes.subarray(at, end));
    at = end;
  }
  const pixels = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { pixels.set(part, offset); offset += part.length; }
  return uint8ArrayToBase64(pixels);
}

/** Handwriting is a page mark. It cannot fill a certificate field or update an already signed PDF. */
export async function renderHandwrittenPdf(source: Uint8Array, placement: ManualSignature, graphic: string): Promise<Uint8Array> {
  const field = manualSignatureSchema.parse(placement);
  if (portableSignatureGraphic(graphic) !== graphic) throw new Error('The retained signature PNG contains unsupported file metadata.');
  const png = base64ToUint8Array(graphic);
  const bytes = new Uint8Array(source);
  if (await identifyOfficialOriginal(bytes.buffer)) throw new Error('Use certificate signing for this official form.');
  const { pages, existingSignatureNames } = await inspectSigningPdf(bytes);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const acro = pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  if (existingSignatureNames.length || acro?.has(PDFName.of('SigFlags')) || acro?.has(PDFName.of('XFA')) || pdf.catalog.has(PDFName.of('Perms')) ||
      pdf.context.enumerateIndirectObjects().some(([, obj]) => obj instanceof PDFDict && (
        obj.has(PDFName.of('ByteRange')) || obj.has(PDFName.of('Lock')) || obj.get(PDFName.of('Type')) === PDFName.of('Sig')
      ))) throw new Error('This PDF has certificate fields or signing restrictions. Use certificate signing.');
  const page = pages[field.page];
  if (!page) throw new Error('The signature box refers to a missing page.');
  const image = await pdf.embedPng(png);
  await image.embed();
  const imageStream = pdf.context.lookup(image.ref);
  if (!(imageStream instanceof PDFRawStream)) throw new Error('The signature image could not be embedded.');
  const samples = decodePDFRawStream(imageStream).decode();
  const mask = imageStream.dict.lookup(PDFName.of('SMask'));
  const alpha = mask instanceof PDFRawStream ? decodePDFRawStream(mask).decode() : undefined;
  let ink = false;
  for (let i = 0; i < image.width * image.height; i++) {
    const dark = 255 - (0.299 * samples[i * 3] + 0.587 * samples[i * 3 + 1] + 0.114 * samples[i * 3 + 2]);
    if (dark * (alpha?.[i] ?? 255) / 255 > 5.5) { ink = true; break; }
  }
  if (!ink) throw new Error('The signature image has no visible ink.');
  const [left, bottom, right, top] = signaturePdfRectangle(field, page);
  const swap = page.rotation === 90 || page.rotation === 270;
  const { width, height } = image.scaleToFit(swap ? top - bottom : right - left, swap ? right - left : top - bottom);
  const centerX = (left + right) / 2, centerY = (bottom + top) / 2;
  // Anchor the rotated image at its center in displayed page coordinates.
  const radians = page.rotation * Math.PI / 180;
  const cos = Math.round(Math.cos(radians)), sin = Math.round(Math.sin(radians));
  pdf.getPage(field.page).drawImage(image, {
    x: centerX - (width * cos - height * sin) / 2,
    y: centerY - (width * sin + height * cos) / 2,
    width, height, rotate: degrees(page.rotation),
  });
  const result = await pdf.save({ updateFieldAppearances: false });
  if (result.length > MAX_SIGNING_PDF_BYTES) throw new Error('The handwritten revision exceeds the 20 MB PDF limit.');
  return result;
}
