import { capturedSigningSourceSchema } from './capturedDocument';
import { z } from 'zod';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { idbCompareSigningRecord, idbReadSigningEntries } from './documentsDb';
import { portableResourceDigest } from './portableResources';
import { MAX_SIGNING_PDF_BYTES } from './manualSignatureFields';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({
  format: z.literal('dondocs-official-signing-v1'), id: z.string().uuid(), filename: z.string().min(1).max(180),
  sourceRevision: capturedSigningSourceSchema.optional(),
  data: z.string().max(Math.ceil(MAX_SIGNING_PDF_BYTES / 3) * 4),
  revisions: z.array(z.object({ length: z.number().int().positive(), sha256: digest })).min(1).max(32),
}).strict();
export type OfficialSigningRecord = z.infer<typeof schema>;
export const isOfficialSigningRecord = (value: unknown) => !!value && typeof value === 'object'
  && 'format' in value && value.format === 'dondocs-official-signing-v1';

export async function officialSigningRecords() {
  return (await idbReadSigningEntries()).filter(entry => isOfficialSigningRecord(entry.value)).map(entry => {
    const record = schema.parse(entry.value);
    if (entry.key !== 'signing-workspace:' + record.id) throw new Error('The saved signing record identity changed.');
    return record;
  });
}

export async function officialRevisionBytes(record: OfficialSigningRecord, index = record.revisions.length - 1) {
  const revision = record.revisions[index];
  if (!revision) throw new Error('The selected signing revision is unavailable.');
  const data = base64ToUint8Array(record.data);
  if (data.length !== record.revisions.at(-1)?.length) throw new Error('The retained signing file is incomplete.');
  const bytes = new Uint8Array(data.subarray(0, revision.length));
  if (await portableResourceDigest(bytes.buffer) !== revision.sha256) throw new Error('The saved revision checksum changed.');
  return bytes;
}

/** Incremental saves keep all earlier revisions as byte-exact prefixes of one retained file. */
export async function saveOfficialRevision(filename: string, data: Uint8Array, current: () => boolean, before?: OfficialSigningRecord, sourceRevision?: OfficialSigningRecord['sourceRevision']) {
  if (!data.length || data.length > MAX_SIGNING_PDF_BYTES) throw new Error('Choose a PDF up to 20 MB.');
  const bytes = new Uint8Array(data);
  if (before) {
    const previous = before.revisions.at(-1)!;
    if (bytes.length <= previous.length || await portableResourceDigest(bytes.buffer.slice(0, previous.length)) !== previous.sha256)
      throw new Error('The returned PDF does not preserve the selected revision.');
  }
  const sha256 = await portableResourceDigest(bytes.buffer);
  const next = schema.parse({ format: 'dondocs-official-signing-v1', id: before?.id ?? crypto.randomUUID(),
    sourceRevision: before?.sourceRevision ?? sourceRevision, filename, data: uint8ArrayToBase64(bytes), revisions: [...before?.revisions ?? [], { length: bytes.length, sha256 }] });
  if (!await idbCompareSigningRecord(before ?? null, next, current)) throw new Error('The signing revision could not be saved. Reopen the current record and retry.');
  return next;
}
