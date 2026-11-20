import { DOC_TYPE_LABELS } from '@/types/document';
import { bodyTableSchema } from '@/lib/bodyTable';
import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { openSessionAsNew, useDocumentsStore, flushDocumentWrites } from '@/stores/documentsStore';
import { createBlankSession, useDocumentStore, type SerializedSession } from '@/stores/documentStore';
import type { DocumentSnapshot } from '@/stores/historyStore';
import { buildDraftFileFromSnapshot, parseDraftFile } from '@/lib/draftFile';
import { buildAssetSharePayload, parseSharedDocument } from '@/lib/assetShare';
import { openSharedDocument } from '@/lib/sharedDocumentActions';
import { parseSharedSession } from '@/lib/sharedSession';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { idbGetAllAttachments, idbGetAllDocuments, idbDeleteDocument, idbDeleteSnapshots, idbDeleteAttachment } from '@/lib/documentsDb';
import { persistAttachment } from '@/lib/attachments';
import { base64ToUint8Array } from '@/lib/encoding';
import { useProfileStore } from '@/stores/profileStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { useUIStore } from '@/stores/uiStore';

type OpaqueSession = SerializedSession & { formData: SerializedSession['formData'] & Record<string, unknown> };
const volume = { version: 1 as const, chapters: [{ id: 'chapter', title: 'Retained title', sections: [{ id: 'section', title: 'Original section' }] }], appendices: [], glossary: [{ id: 'term', term: 'System', definition: 'Keep original definition.' }], changes: [], includeContents: true };
function source(sectionOnly = false): OpaqueSession {
  const session = createBlankSession();
  return { ...session, formData: { ...session.formData, signatureType: 'none', ...(sectionOnly ? {} : { volume: structuredClone(volume) }) }, paragraphs: [{ id: 'block', volumeSectionId: 'section', level: 0, text: 'Original retained body.' }] };
}
function capture(session: SerializedSession): DocumentSnapshot { return { ...session, endItems: [], publicationTables: {} }; }
function saved(session: SerializedSession) { return { meta: { id: 'retained', title: 'Retained source', docType: session.docType, updatedAt: 1 }, session }; }
function model(session: { formData: unknown }) { return (session.formData as Record<string, unknown>).volume; }
async function proofState() { return { live: structuredClone(useDocumentStore.getState().getSnapshot()), library: structuredClone(useDocumentsStore.getState().docs), documents: await idbGetAllDocuments(), attachments: await idbGetAllAttachments() }; }
beforeEach(async () => {
  await flushDocumentWrites();
  useDocumentStore.getState().resetForm();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useUserTemplatesStore.setState({ templates: {} });
  useUIStore.setState({ storageHealth: 'ok' });
  for (const document of await idbGetAllDocuments() ?? []) { await idbDeleteSnapshots(document.id); await idbDeleteDocument(document.id); }
  for (const attachment of await idbGetAllAttachments() ?? []) await idbDeleteAttachment(attachment.id);
});

it.each([false, true])('preserves opaque volume metadata and section bindings across every public transport (section only: %s)', async sectionOnly => {
  const original = source(sectionOnly);
  const shared = await buildAssetSharePayload(capture(original), 123);
  expect(shared).toMatchObject({ kind: 'dondocs-share', version: 7 });
  const reviewed = await parseSharedDocument(shared);
  expect(model(reviewed.session)).toEqual(model(original));
  expect(reviewed.session.paragraphs).toEqual(original.paragraphs);
  expect(openSessionAsNew(parseSharedSession(shared))).toBe('applied');
  expect(model(useDocumentStore.getState())).toEqual(model(original));
  expect(useDocumentStore.getState().paragraphs).toEqual(original.paragraphs);
  const draft = await buildDraftFileFromSnapshot(capture(original), 123);
  expect(draft).toMatchObject({ kind: 'dondocs-draft', version: 5 });
  const restoredDraft = parseDraftFile(JSON.parse(JSON.stringify(draft))).session;
  expect(model(restoredDraft)).toEqual(model(original));
  expect(restoredDraft.paragraphs).toEqual(original.paragraphs);
  useDocumentsStore.setState({ docs: { retained: saved(original) }, currentId: null, baseline: null });
  const backup = await buildBackup();
  expect(JSON.parse(backup).version).toBe(16);
  useDocumentsStore.setState({ docs: {}, currentId: null, baseline: null });
  await restoreBackup(backup);
  expect(model(useDocumentsStore.getState().docs.retained.session)).toEqual(model(original));
  expect(useDocumentsStore.getState().docs.retained.session.paragraphs).toEqual(original.paragraphs);
});

it('retains exact image bytes alongside opaque volume metadata in an asset share and restored workspace', async () => {
  const original = source();
  const bytes = base64ToUint8Array('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
  const fileRef = await persistAttachment({ name: 'retained.png', size: bytes.byteLength, type: 'image/png' }, new Uint8Array(bytes).buffer);
  original.paragraphs.push({ id: 'figure', volumeSectionId: 'section', text: 'Retained figure', level: 0, figure: { fileRef, name: 'retained.png', type: 'image/png', placement: 'body', altText: 'Retained one-pixel fixture' } });
  const shared = await buildAssetSharePayload(capture(original), 123);
  expect(shared).toMatchObject({ version: 6 });
  const reviewed = await parseSharedDocument(shared);
  expect(model(reviewed.session)).toEqual(model(original));
  expect(reviewed.session.paragraphs.map(paragraph => paragraph.volumeSectionId)).toEqual(['section', 'section']);
  expect(new Uint8Array(reviewed.figures[1]!.data)).toEqual(bytes);
  expect(await openSharedDocument(shared)).toBe('applied');
  expect(model(useDocumentStore.getState())).toEqual(model(original));
  const backup = await buildBackup();
  const bundle = JSON.parse(backup);
  expect(bundle.version).toBe(16);
  expect(bundle.attachments.some((attachment: { data: string }) => attachment.data === 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')).toBe(true);
  useDocumentsStore.setState({ docs: {}, currentId: null, baseline: null });
  await restoreBackup(backup);
  expect(Object.values(useDocumentsStore.getState().docs).some(document => model(document.session) && document.session.paragraphs[1]?.volumeSectionId === 'section')).toBe(true);
});

it('admits active volumes only when the document registry supports them', async () => {
  const existing = source();
  useDocumentsStore.setState({ docs: { retained: saved(existing) }, currentId: null, baseline: null });
  const backup = JSON.parse(await buildBackup());
  const active = structuredClone(existing); active.docType = 'technical_volume'; active.formData.docType = 'technical_volume';
  backup.documents = [{ id: 'future', meta: { id: 'future', title: 'Unsupported active volume', docType: 'technical_volume', updatedAt: 1 }, session: active }];
  const before = await proofState();
  if (Object.hasOwn(DOC_TYPE_LABELS, 'technical_volume')) {
    await restoreBackup(JSON.stringify(backup));
    expect(useDocumentsStore.getState().docs.future.session).toEqual(active);
  } else {
    await expect(restoreBackup(JSON.stringify(backup))).rejects.toThrow(/unsupported|cannot read|update/i);
    expect(await proofState()).toEqual(before);
  }
});

it('preserves future table layouts only when the native schema admits them', async () => {
  const original = source(true);
  const raw = { ...original, paragraphs: [{ ...original.paragraphs[0], bodyTable: { rows: [['One', 'Two']], headerRows: 1, columnWidths: [40, 60] } }] };
  const before = await proofState();
  const payload = { kind: 'dondocs-share', version: 7, documentKind: 'correspondence', session: raw };
  if (bodyTableSchema.safeParse(raw.paragraphs[0].bodyTable).success) {
    expect(await openSharedDocument(payload)).toBe('applied');
    expect(useDocumentStore.getState().paragraphs[0].bodyTable).toEqual(raw.paragraphs[0].bodyTable);
  } else {
    await expect(openSharedDocument(payload)).rejects.toThrow();
    expect(await proofState()).toEqual(before);
  }
});
