import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';
import { idbCompareSigningRecord } from './documentsDb';
import { portableSignatureGraphic, renderHandwrittenPdf } from './handwrittenPdf';
import { manualSignatureSchema, type ManualSignature } from './manualSignatureFields';
import { assertSigningRecordFitsTransfer, signingDigest, signingRecordSchema, type SigningRecord } from './signingWorkspace';

export type HandwrittenRevision = NonNullable<SigningRecord['handwritten']>[number];

export async function prepareHandwrittenRevision(record: SigningRecord, placement: ManualSignature, graphic: string): Promise<HandwrittenRevision> {
  if ((record.handwritten?.length ?? 0) >= 10) throw new Error('This record already has ten handwritten revisions.');
  const field = manualSignatureSchema.parse(placement);
  if (record.handwritten?.some(item => item.field.id === field.id)) throw new Error('This placement already has a handwritten signature.');
  const parent = record.handwritten?.at(-1)?.pdf ?? record.source;
  graphic = portableSignatureGraphic(graphic);
  const bytes = await renderHandwrittenPdf(base64ToUint8Array(parent.data), field, graphic);
  return { id: crypto.randomUUID(), parentSha256: parent.sha256, field, graphic,
    pdf: { ...parent, sha256: await signingDigest(bytes), data: uint8ArrayToBase64(bytes) } };
}

/** The caller saves the very PDF displayed for review, atomically with its placements. */
export async function saveHandwrittenRevision(record: SigningRecord, fields: readonly ManualSignature[], revision: HandwrittenRevision, isCurrent: () => boolean) {
  const currentField = fields.find(field => field.id === revision.field.id);
  if (!currentField || JSON.stringify(manualSignatureSchema.parse(currentField)) !== JSON.stringify(revision.field) ||
      revision.parentSha256 !== (record.handwritten?.at(-1)?.pdf ?? record.source).sha256) {
    throw new Error('The signature placement changed. Preview it again.');
  }
  const next = signingRecordSchema.parse({ ...record, fields, revision: crypto.randomUUID(), updatedAt: Date.now(),
    handwritten: [...record.handwritten ?? [], revision] });
  assertSigningRecordFitsTransfer(next);
  if (!await idbCompareSigningRecord(record, next, isCurrent)) throw new Error('The signing record changed or could not be saved. Reopen it and retry.');
  return next;
}
