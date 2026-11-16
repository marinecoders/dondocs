import { PDFDocument, PDFName, PDFNull, PDFNumber, PDFSignature } from 'pdf-lib';
import { z } from 'zod';
import { addSignatureFieldToPage } from '@/services/pdf/signatureFieldCore';

export const MAX_SIGNING_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_SIGNING_PAGES = 100;
export const signingPageSchema = z.object({
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().positive().max(14400), height: z.number().positive().max(14400),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
}).strict();
export type SigningPage = z.infer<typeof signingPageSchema>;
export const manualSignatureSchema = z.object({
  id: z.string().uuid(), signer: z.string().trim().min(1).max(120),
  page: z.number().int().nonnegative().max(MAX_SIGNING_PAGES - 1),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1), height: z.number().min(0.01).max(1),
}).strict().refine(field => field.x + field.width <= 1.00000001 && field.y + field.height <= 1.00000001,
  'Signature boxes must fit entirely on their page.');
export type ManualSignature = z.infer<typeof manualSignatureSchema>;

/** Normalized top-left viewport coordinates are independent of display zoom. */
export function signaturePdfRectangle(field: ManualSignature, input: SigningPage): [number, number, number, number] {
  manualSignatureSchema.parse(field);
  const page = signingPageSchema.parse(input);
  const project = (u: number, v: number): [number, number] => {
    switch (page.rotation) {
      case 90: return [page.x + v * page.width, page.y + u * page.height];
      case 180: return [page.x + (1 - u) * page.width, page.y + v * page.height];
      case 270: return [page.x + (1 - v) * page.width, page.y + (1 - u) * page.height];
      default: return [page.x + u * page.width, page.y + (1 - v) * page.height];
    }
  };
  const a = project(field.x, field.y), b = project(field.x + field.width, field.y + field.height);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export async function inspectSigningPdf(bytes: Uint8Array, allowSigned = false) {
  if (!bytes.length || bytes.length > MAX_SIGNING_PDF_BYTES) throw new Error('Choose a PDF no larger than 20 MB.');
  const pdf = await PDFDocument.load(bytes);
  if (pdf.isEncrypted) throw new Error('Encrypted PDFs cannot be prepared for signing here.');
  if (!pdf.getPageCount() || pdf.getPageCount() > MAX_SIGNING_PAGES) throw new Error('Signing supports PDFs with 1–100 pages.');
  const fields = pdf.getForm().getFields();
  if (!allowSigned && fields.some(field => field instanceof PDFSignature && field.acroField.dict.lookup(PDFName.of('V')) !== undefined
    && field.acroField.dict.lookup(PDFName.of('V')) !== PDFNull)) {
    throw new Error('This PDF already contains a signature. Keep its original bytes; start from an unsigned export to place fields.');
  }
  const pages = pdf.getPages().map(page => {
    const unit = page.node.lookup(PDFName.of('UserUnit'));
    if (unit && (!(unit instanceof PDFNumber) || unit.asNumber() !== 1)) throw new Error('PDF pages with nonstandard user units are not supported for manual placement.');
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const crop = page.getCropBox(), media = page.getMediaBox();
    const x = Math.max(crop.x, media.x), y = Math.max(crop.y, media.y);
    return signingPageSchema.parse({ x, y, width: Math.min(crop.x + crop.width, media.x + media.width) - x,
      height: Math.min(crop.y + crop.height, media.y + media.height) - y, rotation });
  });
  return { pages, existingFieldNames: fields.map(field => field.getName()),
    existingSignatureNames: fields.filter(field => field instanceof PDFSignature).map(field => field.getName()) };
}

export async function placeManualSignatureFields(bytes: Uint8Array, input: readonly ManualSignature[], handoffId?: string): Promise<Uint8Array> {
  const fields = z.array(manualSignatureSchema).max(30).parse(input);
  if (new Set(fields.map(field => field.id)).size !== fields.length) throw new Error('Signature boxes must have unique identities.');
  const { pages, existingFieldNames, existingSignatureNames } = await inspectSigningPdf(bytes);
  if (!fields.length && !existingSignatureNames.length) throw new Error('Add at least one signature box before preparing a signing PDF.');
  const pdf = await PDFDocument.load(bytes);
  if (handoffId) pdf.setKeywords([pdf.getKeywords() ?? '', `DonDocs handoff ${z.string().uuid().parse(handoffId)}`].filter(Boolean));
  for (const field of fields) {
    if (!pages[field.page]) throw new Error('A signature box refers to a missing page.');
    const signer = [...field.signer].map(char => char === '.' || char.charCodeAt(0) < 32 ? ' ' : char).join('');
    const name = `DonDocs ${field.id} ${signer}`;
    if (existingFieldNames.includes(name)) throw new Error('This signature box already exists in the source PDF.');
    addSignatureFieldToPage(pdf, pdf.getPage(field.page), signaturePdfRectangle(field, pages[field.page]), name);
  }
  return pdf.save();
}
