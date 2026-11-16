import { z } from 'zod';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { idbReadSigningRecords, idbCompareSigningRecord } from './documentsDb';
import { inspectSigningPdf, manualSignatureSchema, signingPageSchema, MAX_SIGNING_PDF_BYTES, type ManualSignature } from './manualSignatureFields';

const signingPdfSchema = z.object({
  filename: z.string().min(1).max(180), data: z.string().min(1).max(Math.ceil(MAX_SIGNING_PDF_BYTES / 3) * 4),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(signingPageSchema).min(1).max(100), existingFieldNames: z.array(z.string()).max(1000),
}).strict();
export const signingRecordSchema = z.object({
  format: z.literal('dondocs-signing-v1'), id: z.string().uuid(), revision: z.string().uuid(),
  title: z.string().trim().min(1).max(120), createdAt: z.number().finite(), updatedAt: z.number().finite(),
  source: signingPdfSchema, fields: z.array(manualSignatureSchema).max(30),
}).strict().refine(record => new Set(record.fields.map(field => field.id)).size === record.fields.length
  && record.fields.every(field => field.page < record.source.pages.length), 'Invalid signature page or duplicate box.');
export type SigningRecord = z.infer<typeof signingRecordSchema>;

export async function signingDigest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function captureSigningPdf(bytes: Uint8Array, filename: string) {
  const owned = new Uint8Array(bytes), inspection = await inspectSigningPdf(owned);
  const safeName = [...filename].map(char => char === '/' || char === '\\' || char.charCodeAt(0) < 32 ? '_' : char).join('');
  return signingPdfSchema.parse({ filename: safeName.slice(0, 180) || 'document.pdf',
    data: uint8ArrayToBase64(owned), sha256: await signingDigest(owned), ...inspection });
}
export async function validateSigningRecord(input: unknown): Promise<SigningRecord> {
  const record = signingRecordSchema.parse(input), bytes = base64ToUint8Array(record.source.data);
  if (uint8ArrayToBase64(bytes) !== record.source.data) throw new Error('The saved PDF encoding is not canonical.');
  if (await signingDigest(bytes) !== record.source.sha256) throw new Error('The saved signing PDF does not match its recorded digest.');
  const inspected = await inspectSigningPdf(bytes);
  if (JSON.stringify(inspected.pages) !== JSON.stringify(record.source.pages)
    || JSON.stringify(inspected.existingFieldNames) !== JSON.stringify(record.source.existingFieldNames)) throw new Error('The saved signing PDF geometry has changed.');
  return record;
}
export async function createSigningRecord(bytes: Uint8Array, filename: string, isCurrent: () => boolean = () => true): Promise<SigningRecord> {
  const source = await captureSigningPdf(bytes, filename), now = Date.now();
  const record: SigningRecord = { format: 'dondocs-signing-v1', id: crypto.randomUUID(), revision: crypto.randomUUID(),
    title: source.filename.replace(/\.pdf$/i, '').trim().slice(0, 120) || 'Signing document', createdAt: now, updatedAt: now, source, fields: [] };
  if (!await idbCompareSigningRecord(null, record, isCurrent)) throw new Error('The signing draft could not be saved. Keep your source PDF and retry.');
  return structuredClone(record);
}
export async function listSigningRecords(): Promise<SigningRecord[]> {
  return (await Promise.all((await idbReadSigningRecords()).map(validateSigningRecord))).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function updateSigningFields(before: SigningRecord, fields: readonly ManualSignature[], isCurrent: () => boolean = () => true): Promise<SigningRecord> {
  const after = await validateSigningRecord({ ...before, revision: crypto.randomUUID(), updatedAt: Date.now(), fields });
  if (!await idbCompareSigningRecord(before, after, isCurrent)) throw new Error('This signing draft changed in another tab or the operation was cancelled. Reopen it before saving.');
  return structuredClone(after);
}
