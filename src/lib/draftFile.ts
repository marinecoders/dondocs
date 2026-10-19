import { z } from 'zod';
import { parseFormInstance } from '@/services/forms/model';
import { getSerializedSession, useDocumentStore, type SerializedSession } from '@/stores/documentStore';
import { parseSharedSession } from './sharedSession';
import { arrayBufferToUint8Array, uint8ArrayToBase64, base64ToUint8Array } from './encoding';
import { loadAttachment } from './attachments';
import type { Enclosure, FileRef } from '@/types/document';

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
export function parseDraftFile(value: unknown, localHandles = false): ReviewedDraft {
  // Main's versioned form exporter also writes compact {genericForm} drafts.
  if (value && typeof value === 'object' && 'genericForm' in value && !('documentMode' in value)) {
    const instance = parseFormInstance(value.genericForm);
    value = { documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: instance.definition.formId,
      genericForm: instance, formData: {}, enclosures: [], paragraphs: [], references: [], copyTos: [] };
  }
  if (value && typeof value === 'object' && 'version' in value) {
    value = { references: [], enclosures: [], copyTos: [], ...value };
  }
  const raw = shape.parse(value);
  const session = parseSharedSession(value);
  if (raw.formData.signatureImage) session.formData.signatureImage = image.parse(raw.formData.signatureImage);
  if (session.forms) {
    const key = session.formType === 'navmc_118_11' ? 'navmc11811' : 'navmc10274';
    const original = raw.forms?.[key]?.signatureBlocks;
    if (Array.isArray(original)) session.forms[key]!.signatureBlocks = original.map((block) => z.object({ name: z.string(), statement: z.string(), style: z.enum(['typed', 'image', 'digital']).default('typed'), image: z.string().optional() }).parse(block));
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
export async function buildDraftFile(): Promise<unknown> {
  const session = getSerializedSession();
  const live = useDocumentStore.getState();
  const pack = async (file?: Enclosure['file'], fileRef?: FileRef): Promise<InlineFile | undefined> => {
    const data = file?.data ?? (fileRef ? await loadAttachment(fileRef.id) : null);
    if (!data && fileRef) throw new Error(`Could not read ${fileRef.name}. Reattach it before exporting this draft.`);
    return data ? { name: file?.name ?? fileRef!.name, size: data.byteLength, data: uint8ArrayToBase64(arrayBufferToUint8Array(data)) } : undefined;
  };
  if (session.documentCategory === 'forms') return { version: '1.1', ...session };
  const enclosures = await Promise.all(session.enclosures.map(async (enclosure, index) => {
    const { fileRef, ...text } = enclosure;
    return { ...text, file: await pack(live.enclosures[index]?.file, fileRef) };
  }));
  const { basicLetterFileRef, ...formData } = session.formData;
  const paragraphs = await Promise.all(session.paragraphs.map(async (paragraph) => {
    if (!paragraph.figure) return paragraph;
    const { fileRef, ...figure } = paragraph.figure;
    const packed = await pack(undefined, fileRef);
    return { ...paragraph, figure: { ...figure, data: packed?.data } };
  }));
  return { version: '1.1', ...session, paragraphs, enclosures, formData: { ...formData, basicLetterFile: await pack(live.formData.basicLetterFile, basicLetterFileRef) } };
}
