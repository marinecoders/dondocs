import { z } from 'zod';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { idbReadSigningRecords, idbCompareSigningRecord, idbDeleteSigningRecord } from './documentsDb';
import { inspectSigningPdf, placeManualSignatureFields, manualSignatureSchema, signingPageSchema, MAX_SIGNING_PDF_BYTES, type ManualSignature } from './manualSignatureFields';
import type { CapturedSource } from './capturedDocument';
import { compareSigningPdfs } from './signingPdfComparison';

const signingPdfSchema = z.object({
  filename: z.string().min(1).max(180).refine(value => /\.pdf$/i.test(value)
    && [...value].every(char => char !== '/' && char !== '\\' && char.charCodeAt(0) >= 32), 'Choose a plain PDF filename.'),
  data: z.string().min(1).max(Math.ceil(MAX_SIGNING_PDF_BYTES / 3) * 4),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(signingPageSchema).min(1).max(100), existingFieldNames: z.array(z.string()).max(1000),
  existingSignatureNames: z.array(z.string()).max(1000).optional(),
}).strict();
const capturedSigningSourceSchema = z.object({ documentId: z.string().min(1).max(200), epoch: z.number().int().nonnegative(),
  editSequence: z.number().int().nonnegative(), capturedAt: z.number().finite() }).strict();
const signingHandoffSchema = z.object({ id: z.string().uuid(), createdAt: z.number().finite(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), fields: z.array(manualSignatureSchema).max(30),
  pdf: signingPdfSchema }).strict();
const returnEvidenceSchema = z.object({ assessment: z.enum(['unchanged', 'checks-agree', 'different', 'inconclusive']), checks: z.object({
  samePageGeometry: z.boolean(), contentComparisonAvailable: z.boolean(), sameContentStreams: z.boolean(), originalPrefix: z.boolean(),
  matchingHandoffMarker: z.boolean(), signatureValuesPresent: z.number().int().nonnegative().max(1000),
}).strict() }).strict();
const signingReturnSchema = z.object({ id: z.string().uuid(), handoffId: z.string().uuid(), receivedAt: z.number().finite(),
  pdf: signingPdfSchema, evidence: returnEvidenceSchema, decision: z.object({ reviewed: z.literal(true), acceptedMismatch: z.boolean() }).strict(),
  status: z.literal('associated-unverified'),
}).strict().refine(value => value.evidence.assessment === 'checks-agree' || value.decision.acceptedMismatch, 'Explicit acknowledgement is required for a differing or inconclusive return.');
export const signingRecordSchema = z.object({
  format: z.literal('dondocs-signing-v1'), id: z.string().uuid(), revision: z.string().uuid(),
  title: z.string().trim().min(1).max(120), createdAt: z.number().finite(), updatedAt: z.number().finite(),
  source: signingPdfSchema, fields: z.array(manualSignatureSchema).max(30),
  sourceRevision: capturedSigningSourceSchema.optional(), handoffs: z.array(signingHandoffSchema).max(10).optional(),
  returns: z.array(signingReturnSchema).max(10).optional(),
}).strict().refine(record => new Set(record.fields.map(field => field.id)).size === record.fields.length
  && record.fields.every(field => field.page < record.source.pages.length)
  && new Set(record.handoffs?.map(handoff => handoff.id)).size === (record.handoffs?.length ?? 0)
  && (record.handoffs ?? []).every(handoff => handoff.sourceSha256 === record.source.sha256
    && handoff.fields.every(field => field.page < record.source.pages.length))
  && new Set(record.returns?.map(value => value.id)).size === (record.returns?.length ?? 0)
  && (record.returns ?? []).every(value => record.handoffs?.some(handoff => handoff.id === value.handoffId)), 'Invalid signature page, duplicate identity or missing handoff.');
export type SigningRecord = z.infer<typeof signingRecordSchema>;

export function signingErrorMessage(cause: unknown): string {
  return cause instanceof z.ZodError ? cause.issues[0]?.message ?? 'The signing record is invalid.'
    : cause instanceof Error ? cause.message : 'The signing operation failed.';
}

export async function signingDigest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function captureSigningPdf(bytes: Uint8Array, filename: string, allowSigned = false) {
  const owned = new Uint8Array(bytes), inspection = await inspectSigningPdf(owned, allowSigned);
  const safeName = [...filename].map(char => char === '/' || char === '\\' || char.charCodeAt(0) < 32 ? '_' : char).join('');
  return signingPdfSchema.parse({ filename: `${safeName.replace(/\.pdf$/i, '').slice(0, 176) || 'document'}.pdf`,
    data: uint8ArrayToBase64(owned), sha256: await signingDigest(owned), ...inspection });
}
export async function validateSigningRecord(input: unknown): Promise<SigningRecord> {
  const record = signingRecordSchema.parse(input);
  const retainedPdfs = [{ pdf: record.source, allowSigned: false }, ...(record.handoffs ?? []).map(handoff => ({ pdf: handoff.pdf, allowSigned: false })),
    ...(record.returns ?? []).map(value => ({ pdf: value.pdf, allowSigned: true }))];
  for (const { pdf: retained, allowSigned } of retainedPdfs) {
    const bytes = base64ToUint8Array(retained.data);
    if (uint8ArrayToBase64(bytes) !== retained.data) throw new Error('The saved PDF encoding is not canonical.');
    if (await signingDigest(bytes) !== retained.sha256) throw new Error('The saved signing PDF does not match its recorded digest.');
    const inspected = await inspectSigningPdf(bytes, allowSigned);
    if (JSON.stringify(inspected.pages) !== JSON.stringify(retained.pages)
      || JSON.stringify(inspected.existingFieldNames) !== JSON.stringify(retained.existingFieldNames)
      || retained.existingSignatureNames && JSON.stringify(inspected.existingSignatureNames) !== JSON.stringify(retained.existingSignatureNames)) throw new Error('The saved signing PDF geometry has changed.');
  }
  for (const returned of record.returns ?? []) {
    const handoff = record.handoffs!.find(value => value.id === returned.handoffId)!;
    const evidence = await compareSigningPdfs(base64ToUint8Array(handoff.pdf.data), base64ToUint8Array(returned.pdf.data), handoff.id);
    if (JSON.stringify(evidence) !== JSON.stringify(returned.evidence)) throw new Error('The returned PDF comparison does not match its retained bytes.');
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
  const records: SigningRecord[] = [];
  for (const input of await idbReadSigningRecords()) records.push(await validateSigningRecord(input));
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
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

const returnCandidateBrand = Symbol('signing-return-candidate');
export interface SigningReturnCandidate {
  readonly [returnCandidateBrand]: true;
  readonly pdf: z.infer<typeof signingPdfSchema>;
  readonly evidence: z.infer<typeof returnEvidenceSchema>;
  readonly handoffId: string;
}
const returnCandidates = new WeakMap<SigningReturnCandidate, { before: SigningRecord; returned: Omit<z.infer<typeof signingReturnSchema>, 'decision'> }>();

export async function prepareSigningReturn(input: SigningRecord, handoffId: string, bytes: Uint8Array, filename: string): Promise<SigningReturnCandidate> {
  const before = await validateSigningRecord(input), handoff = before.handoffs?.find(value => value.id === handoffId);
  if (!handoff) throw new Error('Select the exact saved signing handoff before opening a returned PDF.');
  const pdf = await captureSigningPdf(bytes, filename, true);
  const evidence = await compareSigningPdfs(base64ToUint8Array(handoff.pdf.data), base64ToUint8Array(pdf.data), handoff.id);
  const returned = { id: crypto.randomUUID(), handoffId, receivedAt: Date.now(), pdf, evidence, status: 'associated-unverified' as const };
  const candidate = Object.freeze({ [returnCandidateBrand]: true as const, pdf: structuredClone(pdf), evidence: structuredClone(evidence), handoffId });
  returnCandidates.set(candidate, { before, returned });return candidate;
}

export async function associateSigningReturn(input: SigningRecord, candidate: SigningReturnCandidate,
  decision: { reviewed: boolean; acceptedMismatch: boolean }, isCurrent: () => boolean = () => true): Promise<SigningRecord> {
  const owned = returnCandidates.get(candidate);
  if (!owned || JSON.stringify(input) !== JSON.stringify(owned.before)) throw new Error('The signing record changed. Reopen and review this returned PDF again.');
  if (!decision.reviewed) throw new Error('Compare the handoff and returned PDF before associating the file.');
  const returned = signingReturnSchema.parse({ ...owned.returned, decision });
  if (input.returns?.some(value => value.handoffId === returned.handoffId && value.pdf.sha256 === returned.pdf.sha256)) throw new Error('This exact returned PDF is already associated with this handoff.');
  const after = await validateSigningRecord({ ...owned.before, revision: crypto.randomUUID(), updatedAt: Date.now(), returns: [...(owned.before.returns ?? []), returned] });
  if (!await idbCompareSigningRecord(owned.before, after, isCurrent)) throw new Error('The return was not saved. Reopen the signing record and review the file again.');
  returnCandidates.delete(candidate);return structuredClone(after);
}
