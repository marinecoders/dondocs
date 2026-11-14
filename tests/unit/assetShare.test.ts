import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, captureDocumentTarget, flushDocumentWrites, openExistingDocument } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { useProfileStore } from '@/stores/profileStore';
import { buildAssetSharePayload, parseSharedDocument } from '@/lib/assetShare';
import { openSharedDocument } from '@/lib/sharedDocumentActions';
import { encryptSharePayload, decryptSharePayload } from '@/lib/shareCrypto';
import { parseSharedSession } from '@/lib/sharedSession';
import { base64ToUint8Array } from '@/lib/encoding';
import { persistAttachment, loadAttachment } from '@/lib/attachments';
import * as database from '@/lib/documentsDb';
import type { PortableResourceManifest } from '@/lib/portableResources';
import { useFormStore } from '@/stores/formStore';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const pdf = new TextEncoder().encode('%PDF-1.4\nSynthetic support bytes');
interface Envelope { kind: string; version: number; documentKind: string; expiresAt?: number; draft: Record<string, unknown>; resources: PortableResourceManifest; bindings: { slot: string; index?: number; path: string }[] }
const object = (value: unknown) => value as Record<string, unknown>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useUIStore.setState({ storageHealth: 'ok', saveWarning: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'SYNTHETIC SHARED LETTER');
});
afterEach(async () => { vi.restoreAllMocks();await flushDocumentWrites();vi.clearAllTimers();vi.useRealTimers(); });
async function payload(expiresAt?: number) {
  const image = base64ToUint8Array(png);
  const figure = await persistAttachment({ name: 'diagram.png', size: image.byteLength, type: 'image/png' }, new Uint8Array(image).buffer);
  useDocumentStore.setState(state => ({ enclosures: [{ title: 'Support', file: { name: 'support.pdf', size: pdf.byteLength, data: new Uint8Array(pdf).buffer } }],
    paragraphs: [{ id: 'shared-paragraph', text: 'Synthetic body.', level: 0, figure: { name: 'diagram.png', type: 'image/png', fileRef: figure } }],
    formData: { ...state.formData, unitAddress: '  NATIVE ADDRESS\n  EXACT SECOND LINE', signatureImage: { name: 'signature.png', size: image.byteLength, data: png },
      basicLetterFile: { name: 'basic.pdf', size: pdf.byteLength, data: new Uint8Array(pdf).buffer } } }));
  return await buildAssetSharePayload(useDocumentStore.getState().getSnapshot(), Date.now(), expiresAt) as Envelope;
}
it('transfers complete exact native assets through authenticated encryption with no local handles or duplicate inline bytes', async () => {
  const envelope = await payload();
  expect(envelope.version).toBe(4);
  expect(JSON.stringify(envelope.draft)).not.toContain(png);
  expect(JSON.stringify(envelope)).not.toContain('att_');
  expect(envelope.resources.entries).toHaveLength(4);
  expect(() => parseSharedSession(envelope)).toThrow(/unsupported/);
  const encrypted = await encryptSharePayload(envelope, 'synthetic-password');
  await expect(decryptSharePayload(encrypted, 'wrong-password')).rejects.toThrow(/Wrong password/);
  const reviewed = await parseSharedDocument(await decryptSharePayload(encrypted, 'synthetic-password'));
  expect(new Uint8Array(reviewed.files[0]!.data)).toEqual(pdf);
  expect(new Uint8Array(reviewed.basicLetter!.data)).toEqual(pdf);
  expect(reviewed.session.formData.signatureImage!.data).toBe(png);
  expect(new Uint8Array(reviewed.figures[0]!.data)).toEqual(base64ToUint8Array(png));
  expect(reviewed.session.formData.unitAddress).toBe('  NATIVE ADDRESS\n  EXACT SECOND LINE');
});
it('continues ordinary and expiring v1-v3 payloads without manufacturing asset availability', async () => {
  const snapshot = useDocumentStore.getState().getSnapshot();
  const ordinary = await buildAssetSharePayload(snapshot, Date.now());
  expect(ordinary).toMatchObject({ version: 1 });
  expect((await parseSharedDocument(ordinary)).files).toEqual([]);
  expect(await buildAssetSharePayload(snapshot, Date.now(), Date.now() + 1000)).toMatchObject({ version: 3 });
});
it('preserves built-in form signature images and rejects a missing image binding', async () => {
  useDocumentStore.setState({ documentCategory: 'forms', formType: 'navmc_10274' });
  useFormStore.getState().setNavmc10274Field('signatureBlocks', [{ name: 'Synthetic signer', statement: '', style: 'image', image: png }]);
  const envelope = await buildAssetSharePayload(useDocumentStore.getState().getSnapshot(), Date.now()) as Envelope;
  expect(envelope).toMatchObject({ version: 4, documentKind: 'builtin-form' });
  expect((await parseSharedDocument(envelope)).session.forms?.navmc10274?.signatureBlocks[0].image).toBe(png);
  envelope.bindings = [];envelope.resources.entries = [];
  await expect(parseSharedDocument(envelope)).rejects.toThrow(/signature is missing/);
});
it.each([
  ['wrong document kind', (v: Envelope) => { v.documentKind = 'builtin-form'; }],
  ['unsupported version', (v: Envelope) => { v.version = 999; }],
  ['missing resource', (v: Envelope) => { v.resources.entries.pop(); }],
  ['extra resource', (v: Envelope) => { v.resources.entries.push({ ...v.resources.entries[0], path: 'assets/hidden.pdf' }); }],
  ['duplicate target', (v: Envelope) => { v.bindings.push({ ...v.bindings[0] }); }],
  ['wrong slot', (v: Envelope) => { v.bindings[0].index = 999; }],
  ['corrupt bytes', (v: Envelope) => { v.resources.entries[0].sha256 = '0'.repeat(64); }],
  ['missing binding', (v: Envelope) => { v.bindings.shift(); }],
  ['local handle', (v: Envelope) => { object((v.draft.enclosures as unknown[])[0]).fileRef = { id: 'att_foreign', name: 'foreign.pdf', size: 1, type: 'application/pdf' }; }],
  ['ambiguous inline bytes', (v: Envelope) => { object(object((v.draft.enclosures as unknown[])[0]).file).data = png; }],
] as const)('rejects %s before staging resources or changing the current draft', async (_label, mutate) => {
  const envelope = await payload();mutate(envelope);
  const source = useDocumentsStore.getState().currentId;
  const write = vi.spyOn(database, 'idbPutAttachment');
  await expect(openSharedDocument(envelope)).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
  expect(useDocumentsStore.getState().currentId).toBe(source);
});
it('saves a separate durable imported document and retains newer source text', async () => {
  const envelope = await payload(), source = useDocumentsStore.getState().currentId!;
  useDocumentStore.getState().setField('subject', 'NEWER LOCAL WORK');
  expect(await openSharedDocument(envelope)).toBe('applied');
  const imported = useDocumentsStore.getState().currentId!;
  expect(imported).not.toBe(source);
  expect(useDocumentsStore.getState().docs[source].session.formData.subject).toBe('NEWER LOCAL WORK');
  const stored = (await database.idbGetAllDocuments())!.find(record => record.id === imported)!;
  expect(stored.session.formData.unitAddress).toBe('  NATIVE ADDRESS\n  EXACT SECOND LINE');
  const attachmentId = useDocumentStore.getState().enclosures[0].fileRef!.id;
  expect(new Uint8Array((await loadAttachment(attachmentId))!)).toEqual(pdf);
  expect(openExistingDocument(source)).toBe('applied');
  expect(openExistingDocument(imported)).toBe('applied');
  expect(useDocumentStore.getState().formData.unitAddress).toBe('  NATIVE ADDRESS\n  EXACT SECOND LINE');
});
it.each(['asset', 'document'])('leaves the current draft intact after a failed %s commit', async phase => {
  const envelope = await payload(), source = useDocumentsStore.getState().currentId!;
  await flushDocumentWrites();
  if (phase === 'asset') vi.spyOn(database, 'idbPutAttachment').mockResolvedValueOnce(false);
  else vi.spyOn(database, 'idbPutDocument').mockResolvedValueOnce(false);
  await expect(openSharedDocument(envelope)).rejects.toThrow(/could not|Could not/);
  expect(useDocumentsStore.getState().currentId).toBe(source);
  expect(Object.keys(useDocumentsStore.getState().docs)).toEqual([source]);
});
it('removes a newly committed copy if the deadline crosses while the database write is pending', async () => {
  const deadline = Date.now() + 1000, envelope = await payload(deadline), source = useDocumentsStore.getState().currentId;
  await flushDocumentWrites();
  const previous = new Set((await database.idbGetAllDocuments())!.map(record => record.id));
  const put = database.idbPutDocument;
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(database, 'idbPutDocument').mockImplementationOnce(async record => { const saved = await put(record);started();await gate;return saved; });
  const opening = openSharedDocument(envelope);
  await entered;vi.setSystemTime(deadline);release();
  await expect(opening).rejects.toThrow(/expired/);
  expect(useDocumentsStore.getState().currentId).toBe(source);
  expect((await database.idbGetAllDocuments())!.some(record => record.id.startsWith('shared_') && !previous.has(record.id))).toBe(false);
});
it('does not install a share after its captured owner target changes', async () => {
  const envelope = await payload(), target = captureDocumentTarget();
  useDocumentStore.getState().setField('subject', 'NEWER WORK');
  expect(await openSharedDocument(envelope, target)).toBe('stale');
  expect(useDocumentStore.getState().formData.subject).toBe('NEWER WORK');
});
it('does not switch documents after cancellation while the metadata commit is pending', async () => {
  const envelope = await payload(), source = useDocumentsStore.getState().currentId;
  await flushDocumentWrites();
  const previous = new Set((await database.idbGetAllDocuments())!.map(record => record.id));
  const put = database.idbPutDocument;
  let started!: () => void, release!: () => void, active = true;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(database, 'idbPutDocument').mockImplementationOnce(async record => { const saved = await put(record);started();await gate;return saved; });
  const opening = openSharedDocument(envelope, captureDocumentTarget(), () => active);
  await entered;active = false;release();
  await expect(opening).rejects.toThrow(/cancelled/);
  expect(useDocumentsStore.getState().currentId).toBe(source);
  expect((await database.idbGetAllDocuments())!.some(record => record.id.startsWith('shared_') && !previous.has(record.id))).toBe(false);
});
