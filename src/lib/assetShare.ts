import { z } from 'zod';
import type { DocumentSnapshot } from '@/stores/historyStore';
import type { SerializedSession } from '@/stores/documentStore';
import { buildDraftFileFromSnapshot, parseDraftFile, type ReviewedDraft } from './draftFile';
import { serializeDocumentSnapshot } from './documentSerialization';
import { createSharedPayload, parseSharedSession, validateShareExpiration, type SharedDocumentKind } from './sharedSession';
import { buildPortableResources, parsePortableResources, type PortableResourceInput } from './portableResources';
import { base64ToUint8Array, uint8ArrayToBase64 } from './encoding';

const path = z.string().min(1).max(180);
const index = z.number().int().min(0).max(10000);
const bindingSchema = z.discriminatedUnion('slot', [
  z.object({ slot: z.literal('enclosure'), index, path }).strict(),
  z.object({ slot: z.literal('figure'), index, path }).strict(),
  z.object({ slot: z.literal('signature'), path }).strict(),
  z.object({ slot: z.literal('basic-letter'), path }).strict(),
  z.object({ slot: z.literal('form-signature'), index, path }).strict(),
]);
type Binding = z.infer<typeof bindingSchema>;
const envelopeSchema = z.object({ kind: z.literal('dondocs-share'), version: z.literal(4),
  documentKind: z.enum(['correspondence', 'builtin-form', 'configured-form']),
  expiresAt: z.number().int().positive().max(8_640_000_000_000_000).optional(),
  draft: z.record(z.string(), z.unknown()), resources: z.unknown(), bindings: z.array(bindingSchema).max(256),
}).strict();
type AssetShareEnvelope = z.infer<typeof envelopeSchema>;
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The shared asset target is missing or invalid.');
  return value as ObjectValue;
}
function kind(session: SerializedSession): SharedDocumentKind {
  return session.documentCategory === 'forms' ? session.genericForm ? 'configured-form' : 'builtin-form' : 'correspondence';
}
export function isAssetShare(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'kind' in value && value.kind === 'dondocs-share' && 'version' in value && value.version === 4;
}
export function hasShareAssets(snapshot: DocumentSnapshot): boolean {
  return !!(snapshot.formData.signatureImage || snapshot.formData.basicLetterFile || snapshot.formData.basicLetterFileRef
    || snapshot.enclosures.some(item => item.file || item.fileRef)
    || snapshot.paragraphs.some(item => item.figure)
    || [snapshot.forms?.navmc10274, snapshot.forms?.navmc11811].some(form => form?.signatureBlocks?.some(block => block.image || block.imageRef)));
}
export function validateAssetShareExpiration(value: unknown): void {
  if (!isAssetShare(value)) return;
  const envelope = envelopeSchema.parse(value);
  if (envelope.expiresAt !== undefined) validateShareExpiration(envelope.expiresAt);
}
function target(draft: ObjectValue, binding: Binding): { object: ObjectValue; key: string; mediaType: string } {
  const formData = object(draft.formData);
  switch (binding.slot) {
    case 'enclosure': return { object: object((draft.enclosures as unknown[])?.[binding.index]), key: 'file', mediaType: 'application/pdf' };
    case 'basic-letter': return { object: formData, key: 'basicLetterFile', mediaType: 'application/pdf' };
    case 'signature': return { object: formData, key: 'signatureImage', mediaType: 'image/png' };
    case 'figure': {
      const figure = object(object((draft.paragraphs as unknown[])?.[binding.index]).figure);
      if (figure.type !== 'image/png' && figure.type !== 'image/jpeg') throw new Error('Shared figures must be PNG or JPEG images.');
      return { object: figure, key: 'data', mediaType: figure.type };
    }
    case 'form-signature': {
      if (draft.documentCategory !== 'forms' || !['navmc_10274', 'navmc_118_11'].includes(String(draft.formType))) throw new Error('This shared form signature target is unsupported.');
      const forms = object(draft.forms), form = object(forms[draft.formType === 'navmc_118_11' ? 'navmc11811' : 'navmc10274']);
      return { object: object((form.signatureBlocks as unknown[])?.[binding.index]), key: 'image', mediaType: 'image/png' };
    }
  }
}
function validBytes(bytes: Uint8Array, mediaType: string): boolean {
  if (mediaType === 'application/pdf') return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
  if (mediaType === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  return mediaType === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}

/** Reuse native draft serialization; the manifest owns each binary value exactly once. */
export async function buildAssetSharePayload(snapshot: DocumentSnapshot, timestamp: number, expiresAt?: number): Promise<object> {
  const draft = object(await buildDraftFileFromSnapshot(snapshot, timestamp));
  const bindings: Binding[] = [], inputs: PortableResourceInput[] = [];
  const add = (binding: Binding, value: unknown) => {
    const slot = target(draft, binding);
    const original = slot.key === 'data' || slot.key === 'image' ? undefined : object(value);
    const data = original ? original.data : value;
    if (typeof data !== 'string' || !data) throw new Error('A required shared attachment is missing. Reattach it before sharing.');
    const bytes = base64ToUint8Array(data.replace(/^data:image\/png;base64,/, ''));
    if (!validBytes(bytes, slot.mediaType)) throw new Error('A shared attachment does not match its expected file type.');
    const name = String(original?.name ?? slot.object.name ?? `signature-${'index' in binding ? binding.index + 1 : 1}.png`);
    inputs.push({ path: binding.path, name, mediaType: slot.mediaType, data: new Uint8Array(bytes).buffer });
    bindings.push(binding);
    if (original) { delete original.data;slot.object[slot.key] = original; }
    else delete slot.object[slot.key];
  };
  for (const [index, enclosure] of (draft.enclosures as ObjectValue[]).entries()) {
    if (enclosure.hasFile || enclosure.file) add({ slot: 'enclosure', index, path: `assets/enclosure-${index}.pdf` }, enclosure.file);
  }
  for (const [index, paragraph] of (draft.paragraphs as ObjectValue[]).entries()) {
    if (paragraph.figure) add({ slot: 'figure', index, path: `assets/figure-${index}` }, object(paragraph.figure).data);
  }
  const formData = object(draft.formData);
  if (formData.basicLetterFile) add({ slot: 'basic-letter', path: 'assets/basic-letter.pdf' }, formData.basicLetterFile);
  if (formData.signatureImage) add({ slot: 'signature', path: 'assets/signature.png' }, formData.signatureImage);
  if (draft.forms) {
    const form = object(draft.forms)[draft.formType === 'navmc_118_11' ? 'navmc11811' : 'navmc10274'];
    const blocks = form ? object(form).signatureBlocks : undefined;
    if (Array.isArray(blocks)) blocks.forEach((block, index) => { if (object(block).image) add({ slot: 'form-signature', index, path: `assets/form-signature-${index}.png` }, object(block).image); });
  }
  const session = serializeDocumentSnapshot(snapshot, timestamp);
  if (!inputs.length) return expiresAt === undefined ? createSharedPayload(session) : createSharedPayload(session, expiresAt);
  const envelope: AssetShareEnvelope = { kind: 'dondocs-share', version: 4, documentKind: kind(session),
    ...(expiresAt === undefined ? {} : { expiresAt }), draft, resources: await buildPortableResources(inputs), bindings };
  await parseAssetSharePayload(envelope);
  return envelope;
}

/** Validate the entire inventory and every slot before staging any local resource. */
export async function parseAssetSharePayload(value: unknown): Promise<ReviewedDraft> {
  const result = envelopeSchema.safeParse(structuredClone(value));
  if (!result.success) throw new Error('This asset-inclusive share is invalid or unsupported.');
  const envelope = result.data;
  validateAssetShareExpiration(envelope);
  const raw = envelope.draft, rawForm = object(raw.formData);
  if (raw.portableResources !== undefined || raw.portableFormTemplates !== undefined) throw new Error('This reader does not support shared configured-form template resources.');
  if (rawForm.basicLetterFileRef !== undefined || rawForm.signatureImage && object(rawForm.signatureImage).fileRef !== undefined
    || (raw.enclosures as unknown[] | undefined)?.some(item => object(item).fileRef !== undefined)
    || (raw.paragraphs as unknown[] | undefined)?.some(item => object(item).figure && object(object(item).figure).fileRef !== undefined)) throw new Error('A shared attachment cannot use device-local file handles.');
  if ((raw.enclosures as unknown[] | undefined)?.some(item => object(item).file && object(object(item).file).data !== undefined)
    || (raw.paragraphs as unknown[] | undefined)?.some(item => object(item).figure && object(object(item).figure).data !== undefined)
    || rawForm.signatureImage && object(rawForm.signatureImage).data !== undefined
    || rawForm.basicLetterFile && object(rawForm.basicLetterFile).data !== undefined) throw new Error('This share includes ambiguous inline attachment bytes.');
  if (raw.forms) for (const value of Object.values(object(raw.forms))) {
    if (value && typeof value === 'object' && Array.isArray(object(value).signatureBlocks)
      && (object(value).signatureBlocks as unknown[]).some(block => object(block).image !== undefined || object(block).imageRef !== undefined)) throw new Error('This share includes ambiguous inline signature bytes or device-local handles.');
  }
  const resources = await parsePortableResources(envelope.resources);
  const boundPaths = new Set<string>(), boundSlots = new Set<string>();
  for (const binding of envelope.bindings) {
    const slotKey = `${binding.slot}:${'index' in binding ? binding.index : ''}`;
    if (boundSlots.has(slotKey) || boundPaths.has(binding.path)) throw new Error('This share repeats an attachment target or resource binding.');
    boundSlots.add(slotKey);boundPaths.add(binding.path);
    const resource = resources.get(binding.path);
    if (!resource) throw new Error('A required shared resource is missing.');
    const slot = target(envelope.draft, binding);
    if (resource.mediaType !== slot.mediaType || !validBytes(new Uint8Array(resource.data), slot.mediaType)) throw new Error('A shared attachment does not match its target file type.');
    if (slot.key === 'data' || slot.key === 'image') {
      if (slot.object[slot.key] !== undefined) throw new Error('This share includes ambiguous inline attachment bytes.');
      slot.object[slot.key] = uint8ArrayToBase64(new Uint8Array(resource.data));
    } else {
      const metadata = object(slot.object[slot.key]);
      if (metadata.data !== undefined || metadata.name !== resource.name || metadata.size !== resource.data.byteLength) throw new Error('This shared attachment has inconsistent metadata.');
      slot.object[slot.key] = { ...metadata, data: uint8ArrayToBase64(new Uint8Array(resource.data)) };
    }
  }
  if (resources.size !== boundPaths.size) throw new Error('This share includes unreferenced resources.');
  // A legacy parser cannot accept the nested v4 envelope and discard its assets.
  const reviewed = parseDraftFile(envelope.draft, false, true);
  for (const form of [reviewed.session.forms?.navmc10274, reviewed.session.forms?.navmc11811]) {
    if (form?.signatureBlocks.some(block => block.style === 'image' && !block.image)) throw new Error('A required form signature is missing from this share.');
  }
  if (kind(reviewed.session) !== envelope.documentKind) throw new Error('The shared document kind does not match its contents.');
  validateAssetShareExpiration(envelope);
  return reviewed;
}

/** A common importer keeps legacy shares readable and never downgrades malformed v4. */
export async function parseSharedDocument(value: unknown): Promise<ReviewedDraft> {
  return isAssetShare(value) ? parseAssetSharePayload(value) : { session: parseSharedSession(value), files: [], figures: [] };
}
