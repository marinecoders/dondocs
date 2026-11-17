import { resolveSignature, resolveFormSignatures } from './signatureAssets';
import { flushPendingReviewWrites, hasPendingReviewWrites, useDocumentsStore, captureDocumentTarget, isCurrentDocumentTarget } from '@/stores/documentsStore';
import { z } from 'zod';
import { parseFormInstance } from '@/services/forms/model';
import { getSerializedSession, useDocumentStore, type SerializedSession } from '@/stores/documentStore';
import { parseSharedSession, draftEnvelope } from './sharedSession';
import { arrayBufferToUint8Array, uint8ArrayToBase64, base64ToUint8Array } from './encoding';
import { loadAttachment } from './attachments';
import type { Enclosure, FileRef } from '@/types/document';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { serializeDocumentSnapshot } from './documentSerialization';
import { capturePortableFormTemplates, validatePortableFormTemplates, type PortableFormTemplateBundle } from '@/services/forms/portableTemplates';
import { wordSourceSchema } from './wordSource';
import { validateWordSourceFile } from './wordSourceResources';

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
export interface ReviewedDraft { session: SerializedSession; files: Array<Enclosure['file']>; figures: Array<Enclosure['file']>; basicLetter?: NonNullable<Enclosure['file']>; wordSourceFile?: NonNullable<Enclosure['file']>; formTemplates?: PortableFormTemplateBundle }
const decode = (file: InlineFile): NonNullable<Enclosure['file']> => {
  const bytes = base64ToUint8Array(file.data);
  return { name: file.name, size: bytes.byteLength, data: bytes.buffer as ArrayBuffer };
};

/** Parse every file before changing the live editor; external handles are discarded. */
export function parseDraftFile(value: unknown, localHandles = false, requireCompleteAssets = false): ReviewedDraft {
  // Main's versioned form exporter also writes compact {genericForm} drafts.
  if (value && typeof value === 'object' && 'genericForm' in value && !('documentMode' in value) && !('kind' in value) && !('expiresAt' in value)) {
    if ('portableFormTemplates' in value || 'portableResources' in value) throw new Error('Portable form resources require a versioned complete draft.');
    const instance = parseFormInstance(value.genericForm);
    value = { documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: instance.definition.formId,
      genericForm: instance, formData: {}, enclosures: [], paragraphs: [], references: [], copyTos: [] };
  }
  if (value && typeof value === 'object' && 'version' in value) {
    value = { references: [], enclosures: [], copyTos: [], ...value };
  }
  const raw = shape.parse(value);
  const portable = z.object({ portableFormTemplates: z.unknown().optional(), portableResources: z.unknown().optional() }).parse(value);
  const hasPortable = portable.portableFormTemplates !== undefined || portable.portableResources !== undefined;
  if (hasPortable && (portable.portableFormTemplates === undefined || portable.portableResources === undefined)) throw new Error('The portable form template inventory is incomplete.');
  if (raw.kind === 'dondocs-draft' && raw.version === 3 && !hasPortable) throw new Error('This portable form draft is missing its required templates.');
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
  let wordSourceFile: NonNullable<Enclosure['file']> | undefined;
  if (raw.formData.wordSource !== undefined) {
    const metadata = wordSourceSchema.parse(raw.formData.wordSource);
    if (raw.wordSourceFile !== undefined) {
      const source = inlineFile.parse(raw.wordSourceFile);
      if (source.data.length > Math.ceil(20 * 1024 * 1024 / 3) * 4) throw new Error('The original Word file exceeds 20 MB.');
      wordSourceFile = decode(source);
      if (source.name !== metadata.name || source.size !== wordSourceFile.size || uint8ArrayToBase64(new Uint8Array(wordSourceFile.data)) !== source.data) throw new Error('The original Word resource has inconsistent metadata or encoded bytes.');
    } else if (requireCompleteAssets) throw new Error('The original Word source is missing from this complete draft.');
    session.formData.wordSource = { ...metadata, fileRef: localHandles ? metadata.fileRef : undefined };
  }
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
  if (hasPortable && !session.genericForm) throw new Error('Portable form templates require a configured form.');
  return { session, files, figures, basicLetter, ...(wordSourceFile ? { wordSourceFile } : {}),
    ...(hasPortable ? { formTemplates: { portableFormTemplates: portable.portableFormTemplates, portableResources: portable.portableResources } as PortableFormTemplateBundle } : {}),
  };
}

/** External form drafts validate every captured template before showing review. */
export async function parsePortableDraft(value: unknown, localHandles = false, requireCompleteAssets = false): Promise<ReviewedDraft> {
  const reviewed = parseDraftFile(value, localHandles, requireCompleteAssets);
  if (reviewed.wordSourceFile && reviewed.session.formData.wordSource) await validateWordSourceFile(reviewed.wordSourceFile, reviewed.session.formData.wordSource);
  if (reviewed.formTemplates) await validatePortableFormTemplates([reviewed.session.genericForm!.definition], reviewed.formTemplates.portableFormTemplates, reviewed.formTemplates.portableResources);
  return reviewed;
}

/** A portable copy of only the active document, including binary attachments. */
let draftExports = 0;
export function isDraftExportInProgress(): boolean { return draftExports > 0; }
export async function buildDraftFile(): Promise<unknown> {
  draftExports++;
  try {
    const ownerId = useDocumentsStore.getState().currentId ?? undefined;
    if (hasPendingReviewWrites(ownerId)) {
      const target = captureDocumentTarget();
      await flushPendingReviewWrites(ownerId);
      if (!isCurrentDocumentTarget(target)) throw new Error('The draft changed while its feedback was saving. Export the current draft again.');
    }
    const snapshot = structuredClone(useDocumentStore.getState().getSnapshot());
    const session = getSerializedSession();
    return await serializeDraft(session, snapshot);
  } finally { draftExports--; }
}
/** Reuse draft transfer for a pinned revision without reading the current editor. */
export async function buildDraftFileFromSnapshot(snapshot: DocumentSnapshot, timestamp: number, readAsset?: typeof loadAttachment): Promise<unknown> {
  const owned = structuredClone(snapshot);
  const session = serializeDocumentSnapshot(owned, timestamp);
  draftExports++;
  try { return await serializeDraft(session, owned, readAsset); } finally { draftExports--; }
}
async function serializeDraft(session: SerializedSession, live: DocumentSnapshot, readAsset?: typeof loadAttachment): Promise<unknown> {
  const pack = async (file?: Enclosure['file'], fileRef?: FileRef): Promise<InlineFile | undefined> => {
    const data = file?.data ?? (fileRef ? await (readAsset ?? loadAttachment)(fileRef.id) : null);
    if (!data && fileRef) throw new Error(`Could not read ${fileRef.name}. Reattach it before exporting this draft.`);
    return data ? { name: file?.name ?? fileRef!.name, size: data.byteLength, data: uint8ArrayToBase64(arrayBufferToUint8Array(data)) } : undefined;
  };
  if (session.documentCategory === 'forms') {
    if (session.genericForm) {
      const portable = await capturePortableFormTemplates([session.genericForm.definition]);
      return { ...session, kind: 'dondocs-draft', version: 3, documentKind: 'configured-form', ...portable };
    }
    for (const form of [session.forms?.navmc10274, session.forms?.navmc11811]) {
      if (!form) continue;
      const resolved = await resolveFormSignatures(form, 'transfer', readAsset);
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
  let wordSourceFile: InlineFile | undefined;
  if (formData.wordSource) {
    const ref = formData.wordSource.fileRef;
    const data = ref ? await (readAsset ?? loadAttachment)(ref.id) : null;
    if (!data) throw new Error('The original Word file is unavailable. Restore it before exporting a complete draft.');
    await validateWordSourceFile({ data }, formData.wordSource);
    wordSourceFile = { name: formData.wordSource.name, size: data.byteLength, data: uint8ArrayToBase64(new Uint8Array(data)) };
  }
  if (formData.wordSource) formData.wordSource = { ...formData.wordSource, fileRef: undefined };
  const signature = await resolveSignature(formData.signatureImage, readAsset);
  if (signature) {
    const { fileRef: _ref, ...image } = signature;
    // Uploads can be normalized from JPEG to PNG; serialize the delivered size.
    if (image.data) image.size = base64ToUint8Array(image.data.replace(/^data:image\/[^;]+;base64,/, '')).byteLength;
    formData.signatureImage = image;
  }
  const paragraphs = await Promise.all(session.paragraphs.map(async (paragraph) => {
    if (!paragraph.figure) return paragraph;
    const { fileRef, ...figure } = paragraph.figure;
    const packed = await pack(undefined, fileRef);
    return { ...paragraph, figure: { ...figure, data: packed?.data } };
  }));
  return { ...draftEnvelope(session), ...session, paragraphs, enclosures, ...(wordSourceFile ? { wordSourceFile } : {}), formData: { ...formData, basicLetterFile: await pack(live.formData.basicLetterFile, basicLetterFileRef) } };
}
