import { resolveSignature, resolveFormSignatures } from './signatureAssets';
import { z } from 'zod';
import { parseFormInstance } from '@/services/forms/model';
import { getSerializedSession, useDocumentStore, type SerializedSession } from '@/stores/documentStore';
import { parseSharedSession, draftEnvelope } from './sharedSession';
import { arrayBufferToUint8Array, uint8ArrayToBase64, base64ToUint8Array } from './encoding';
import { loadAttachment } from './attachments';
import type { Enclosure, FileRef } from '@/types/document';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { serializeDocumentSnapshot } from './documentSerialization';

const image = z.object({ name: z.string(), size: z.number(), data: z.string() });
const ref = z.object({ id: z.string(), name: z.string(), size: z.number(), type: z.string() });
const inlineFile = z.object({ name: z.string(), size: z.number(), data: z.string() });
const shape = z.object({
  formData: z.record(z.string(), z.unknown()),
  enclosures: z.array(z.object({ file: inlineFile.nullish(), fileRef: ref.optional() }).passthrough()),
  paragraphs: z.array(z.object({ figure: z.object({ data: z.string().optional(), fileRef: ref.optional(), name: z.string().optional(), type: z.string().optional() }).passthrough().optional() }).passthrough()),
  forms: z.object({ navmc10274: z.record(z.string(), z.unknown()).optional(), navmc11811: z.record(z.string(), z.unknown()).optional() }).passthrough().optional(),
}).passthrough();
type InlineFile = z.infer<typeof inlineFile>;
export interface ReviewedDraft { session: SerializedSession; files: Array<Enclosure['file']>; figures: Array<Enclosure['file']>; basicLetter?: NonNullable<Enclosure['file']> }
const decode = (file: InlineFile): NonNullable<Enclosure['file']> => {
  const bytes = base64ToUint8Array(file.data);
  return { name: file.name, size: bytes.byteLength, data: bytes.buffer as ArrayBuffer };
};

/** Parse every file before changing the live editor; external handles are discarded. */
export function parseDraftFile(value: unknown, localHandles = false, requireCompleteAssets = false): ReviewedDraft {
  // Main's versioned form exporter also writes compact {genericForm} drafts.
  if (value && typeof value === 'object' && 'genericForm' in value && !('documentMode' in value) && !('kind' in value) && !('expiresAt' in value)) {
    const instance = parseFormInstance(value.genericForm);
    value = { documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: instance.definition.formId,
      genericForm: instance, formData: {}, enclosures: [], paragraphs: [], references: [], copyTos: [] };
  }
  if (value && typeof value === 'object' && 'version' in value) {
    value = { references: [], enclosures: [], copyTos: [], ...value };
  }
  const raw = shape.parse(value);
  if (requireCompleteAssets) {
    for (const enclosure of raw.enclosures) {
      if ((enclosure.hasFile || enclosure.fileRef) && !enclosure.file) throw new Error('An attached PDF is missing from this reviewer file.');
    }
    for (const paragraph of raw.paragraphs) {
      if (paragraph.figure && !paragraph.figure.data) throw new Error('A figure image is missing from this reviewer file.');
    }
    if (raw.formData.basicLetterFileRef && !raw.formData.basicLetterFile) throw new Error('The basic-letter PDF is missing from this reviewer file.');
    if (raw.formData.signatureImage && !image.parse(raw.formData.signatureImage).data) throw new Error('A signature image is missing from this reviewer file.');
  }
  const session = parseSharedSession(value);
  if (raw.formData.signatureImage) {
    session.formData.signatureImage = image.parse(raw.formData.signatureImage);
    if (localHandles) {
      const saved = z.object({ fileRef: ref.optional() }).parse(raw.formData.signatureImage);
      if (saved.fileRef) session.formData.signatureImage.fileRef = saved.fileRef;
    }
  }
  if (session.forms) {
    const key = session.formType === 'navmc_118_11' ? 'navmc11811' : 'navmc10274';
    const original = raw.forms?.[key]?.signatureBlocks;
    if (Array.isArray(original)) session.forms[key]!.signatureBlocks = original.map((block) => {
      const decoded = z.object({ name: z.string(), statement: z.string(), style: z.enum(['typed', 'image', 'digital']).default('typed'), image: z.string().optional(), imageRef: ref.optional() }).parse(block);
      if (!localHandles) delete decoded.imageRef;
      return decoded;
    });
  }
  const files = raw.enclosures.map((enclosure, index) => {
    if (localHandles && enclosure.fileRef) session.enclosures[index].fileRef = enclosure.fileRef;
    return enclosure.file ? decode(enclosure.file) : undefined;
  });
  if (localHandles && raw.formData.basicLetterFileRef) session.formData.basicLetterFileRef = ref.parse(raw.formData.basicLetterFileRef);
  const basicLetter = raw.formData.basicLetterFile ? decode(inlineFile.parse(raw.formData.basicLetterFile)) : undefined;
  const figures = raw.paragraphs.map((paragraph, index) => {
    const figure = paragraph.figure;
    if (localHandles && figure?.fileRef && session.paragraphs[index].figure) session.paragraphs[index].figure!.fileRef = figure.fileRef;
    return figure?.data ? decode({ name: figure.name ?? 'figure', size: 0, data: figure.data }) : undefined;
  });
  return { session, files, figures, basicLetter };
}

/** A portable copy of only the active document, including binary attachments. */
let draftExports = 0;
export function isDraftExportInProgress(): boolean { return draftExports > 0; }
export async function buildDraftFile(): Promise<unknown> {
  draftExports++;
  try {
    const snapshot = structuredClone(useDocumentStore.getState().getSnapshot());
    const session = getSerializedSession();
    return await serializeDraft(session, snapshot);
  } finally { draftExports--; }
}
/** Reuse draft transfer for a pinned revision without reading the current editor. */
export async function buildDraftFileFromSnapshot(snapshot: DocumentSnapshot, timestamp: number): Promise<unknown> {
  const owned = structuredClone(snapshot);
  const session = serializeDocumentSnapshot(owned, timestamp);
  draftExports++;
  try { return await serializeDraft(session, owned); } finally { draftExports--; }
}
async function serializeDraft(session: SerializedSession, live: DocumentSnapshot): Promise<unknown> {
  const pack = async (file?: Enclosure['file'], fileRef?: FileRef): Promise<InlineFile | undefined> => {
    const data = file?.data ?? (fileRef ? await loadAttachment(fileRef.id) : null);
    if (!data && fileRef) throw new Error(`Could not read ${fileRef.name}. Reattach it before exporting this draft.`);
    return data ? { name: file?.name ?? fileRef!.name, size: data.byteLength, data: uint8ArrayToBase64(arrayBufferToUint8Array(data)) } : undefined;
  };
  if (session.documentCategory === 'forms') {
    for (const form of [session.forms?.navmc10274, session.forms?.navmc11811]) {
      if (!form) continue;
      const resolved = await resolveFormSignatures(form, 'transfer');
      form.signatureBlocks = resolved.signatureBlocks.map(({ imageRef: _ref, ...block }) => block);
    }
    return { ...draftEnvelope(session), ...session };
  }
  const enclosures = await Promise.all(session.enclosures.map(async (enclosure, index) => {
    const { fileRef, ...text } = enclosure;
    const file = await pack(live.enclosures[index]?.file, fileRef);
    return { ...text, hasFile: !!file, file };
  }));
  const { basicLetterFileRef, ...formData } = session.formData;
  const signature = await resolveSignature(formData.signatureImage);
  if (signature) { const { fileRef: _ref, ...image } = signature; formData.signatureImage = image; }
  const paragraphs = await Promise.all(session.paragraphs.map(async (paragraph) => {
    if (!paragraph.figure) return paragraph;
    const { fileRef, ...figure } = paragraph.figure;
    const packed = await pack(undefined, fileRef);
    return { ...paragraph, figure: { ...figure, data: packed?.data } };
  }));
  return { ...draftEnvelope(session), ...session, paragraphs, enclosures, formData: { ...formData, basicLetterFile: await pack(live.formData.basicLetterFile, basicLetterFileRef) } };
}
