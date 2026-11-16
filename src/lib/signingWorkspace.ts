import { z } from 'zod';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { idbReadSigningRecords, idbCompareSigningRecord, idbDeleteSigningRecord } from './documentsDb';
import { inspectSigningPdf, placeManualSignatureFields, manualSignatureSchema, signingPageSchema, MAX_SIGNING_PDF_BYTES, type ManualSignature } from './manualSignatureFields';
import type { CapturedSource } from './capturedDocument';

const signingPdfSchema = z.object({
  filename: z.string().min(1).max(180), data: z.string().min(1).max(Math.ceil(MAX_SIGNING_PDF_BYTES / 3) * 4),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(signingPageSchema).min(1).max(100), existingFieldNames: z.array(z.string()).max(1000),
  existingSignatureNames: z.array(z.string()).max(1000).optional(),
}).strict();
const capturedSigningSourceSchema = z.object({ documentId: z.string().min(1).max(200), epoch: z.number().int().nonnegative(),
  editSequence: z.number().int().nonnegative(), capturedAt: z.number().finite() }).strict();
const signingHandoffSchema = z.object({ id: z.string().uuid(), createdAt: z.number().finite(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), fields: z.array(manualSignatureSchema).max(30),
  pdf: signingPdfSchema }).strict();
export const signingRecordSchema = z.object({
  format: z.literal('dondocs-signing-v1'), id: z.string().uuid(), revision: z.string().uuid(),
  title: z.string().trim().min(1).max(120), createdAt: z.number().finite(), updatedAt: z.number().finite(),
  source: signingPdfSchema, fields: z.array(manualSignatureSchema).max(30),
  sourceRevision: capturedSigningSourceSchema.optional(), handoffs: z.array(signingHandoffSchema).max(10).optional(),
}).strict().refine(record => new Set(record.fields.map(field => field.id)).size === record.fields.length
  && record.fields.every(field => field.page < record.source.pages.length)
  && new Set(record.handoffs?.map(handoff => handoff.id)).size === (record.handoffs?.length ?? 0)
  && (record.handoffs ?? []).every(handoff => handoff.sourceSha256 === record.source.sha256
    && handoff.fields.every(field => field.page < record.source.pages.length)), 'Invalid signature page or duplicate box.');
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
  const record = signingRecordSchema.parse(input);
  for (const retained of [record.source, ...(record.handoffs ?? []).map(handoff => handoff.pdf)]) {
    const bytes = base64ToUint8Array(retained.data);
    if (uint8ArrayToBase64(bytes) !== retained.data) throw new Error('The saved PDF encoding is not canonical.');
    if (await signingDigest(bytes) !== retained.sha256) throw new Error('The saved signing PDF does not match its recorded digest.');
    const inspected = await inspectSigningPdf(bytes);
    if (JSON.stringify(inspected.pages) !== JSON.stringify(retained.pages)
      || JSON.stringify(inspected.existingFieldNames) !== JSON.stringify(retained.existingFieldNames)
      || retained.existingSignatureNames && JSON.stringify(inspected.existingSignatureNames) !== JSON.stringify(retained.existingSignatureNames)) throw new Error('The saved signing PDF geometry has changed.');
  }
  return record;
}
export async function createSigningRecord(bytes: Uint8Array, filename: string, isCurrent: () => boolean = () => true, sourceRevision?: CapturedSource): Promise<SigningRecord> {
  const source = await captureSigningPdf(bytes, filename), now = Date.now();
  const record: SigningRecord = { format: 'dondocs-signing-v1', id: crypto.randomUUID(), revision: crypto.randomUUID(),
    title: source.filename.replace(/\.pdf$/i, '').trim().slice(0, 120) || 'Signing document', createdAt: now, updatedAt: now, source, fields: [],
    ...(sourceRevision ? { sourceRevision: capturedSigningSourceSchema.parse(sourceRevision) } : {}) };
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

export async function createSigningHandoff(before: SigningRecord, isCurrent: () => boolean = () => true): Promise<SigningRecord> {
  const owned = await validateSigningRecord(before), id = crypto.randomUUID();
  const bytes = await placeManualSignatureFields(base64ToUint8Array(owned.source.data), owned.fields, id);
  const handoff = signingHandoffSchema.parse({ id, createdAt: Date.now(), sourceSha256: owned.source.sha256,
    fields: owned.fields, pdf: await captureSigningPdf(bytes, `ready-to-sign-${owned.source.filename}`) });
  const after = await validateSigningRecord({ ...owned, revision: crypto.randomUUID(), updatedAt: Date.now(), handoffs: [...(owned.handoffs ?? []), handoff] });
  if (!await idbCompareSigningRecord(before, after, isCurrent)) throw new Error('The signing handoff was not saved. Reopen the signing draft and retry.');
  return structuredClone(after);
}

/** Portable records include exact originals and every retained handoff. */
export async function exportSigningRecord(input: SigningRecord): Promise<Uint8Array> {
  return new TextEncoder().encode(JSON.stringify(await validateSigningRecord(input)));
}
export async function importSigningRecord(input: unknown, isCurrent: () => boolean = () => true): Promise<SigningRecord> {
  const record = await validateSigningRecord(input);
  const existing = (await idbReadSigningRecords()).find(value => !!value && typeof value === 'object' && 'id' in value && value.id === record.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error('A different signing record with this identity already exists. Keep both files and review them separately.');
    return record;
  }
  if (!await idbCompareSigningRecord(null, record, isCurrent)) throw new Error('The signing record could not be imported.');
  return structuredClone(record);
}

export async function removeSigningRecord(input: SigningRecord, isCurrent: () => boolean = () => true): Promise<void> {
  const record = await validateSigningRecord(input);
  if (!await idbDeleteSigningRecord(record, isCurrent)) throw new Error('The signing record changed or removal was cancelled. Reopen it and retry.');
}

export async function downloadSigningHandoff(input: SigningRecord, handoffId: string): Promise<Uint8Array> {
  const record = await validateSigningRecord(input), handoff = record.handoffs?.find(value => value.id === handoffId);
  if (!handoff) throw new Error('The selected signing handoff no longer exists.');
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('ready-to-sign.pdf', base64ToUint8Array(handoff.pdf.data));
  zip.file('manifest.json', JSON.stringify({ format: 'dondocs-signing-handoff-v1', handoffId: handoff.id,
    createdAt: handoff.createdAt, sourceSha256: handoff.sourceSha256, pdfSha256: handoff.pdf.sha256,
    sourceRevision: record.sourceRevision, fields: handoff.fields, existingSignatureFields: record.source.existingSignatureNames ?? [] }, null, 2));
  zip.file('README.txt', `Signing handoff ${handoff.id}\n\nOpen ready-to-sign.pdf in your signing application.\nReview every page and use the signature field assigned to you.\nReturn the signed PDF without printing or scanning it.\nKeep manifest.json with the return so the drafter can select this handoff.\n\nThe PDF is tied to this saved handoff; later draft edits do not update it.\nSHA-256 identifies file bytes; it does not authenticate a signer.\nThis ZIP is unencrypted.\n`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
