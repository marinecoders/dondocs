import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { capturePortableFormTemplates, validatePortableFormTemplates } from '@/services/forms/portableTemplates';
import { digest, packageAvailableOffline, retainPackagePages, removeUnusedPackages } from '@/services/forms/packages';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { formCache } from '../_helpers/formCache';
import { buildDraftFile, parsePortableDraft, parseDraftFile } from '@/lib/draftFile';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { captureDocumentTarget, openFormInstance, openReviewedDocument, useDocumentsStore, flushDocumentWrites } from '@/stores/documentsStore';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { useProfileStore } from '@/stores/profileStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { useUIStore } from '@/stores/uiStore';
import { idbFormDefinitions, idbGetAllDocuments, idbSetSnapshots, idbPutDocument, idbReadAttachment } from '@/lib/documentsDb';
import * as db from '@/lib/documentsDb';
import { collectLiveAttachmentIds } from '@/lib/attachmentGc';
import { formTemplateAttachmentId } from '@/lib/formTemplateAssets';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState({ genericForm: undefined, documentCategory: 'correspondence' });
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useUserTemplatesStore.setState({ templates: {} });
  useUIStore.setState({ storageHealth: 'ok' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

let sourceRevision = 0;
async function source() {
  const instance = fixtureInstance(), original = await fixturePage();
  const document = await PDFDocument.load(original.bytes);document.setTitle(`Portable fixture ${++sourceRevision}`);
  const bytes = await document.save(), page = { bytes, sha256: await digest(bytes) };
  instance.definition.pages[0].sha256 = page.sha256;
  instance.answers.name = 'PORTABLE ORIGINAL';
  instance.rows.roster = [{ id: 'retained-row', answers: { grade: 'e2', date: '2026-11-14' } }];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(page.bytes))));
  return { instance, page };
}

it('carries exact template bytes with the saved definition and answers, without a catalog on import', async () => {
  formCache();
  const { instance, page } = await source();
  openFormInstance(instance);
  const exported = JSON.parse(JSON.stringify(await buildDraftFile()));
  expect(exported).toMatchObject({ kind: 'dondocs-draft', version: 3, documentKind: 'configured-form' });
  expect(exported.portableResources.entries).toHaveLength(1);
  expect(exported.portableResources.entries[0].sha256).toBe(page.sha256);
  const received = formCache();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline and no catalog'); }));
  const reviewed = await parsePortableDraft(exported);
  expect(await openReviewedDocument(reviewed, captureDocumentTarget())).toBe('applied');
  expect(await packageAvailableOffline(instance.definition)).toBe(true);
  expect(new Uint8Array(await received.entries.get(`/__form_assets/${page.sha256}.pdf`)!.clone().arrayBuffer())).toEqual(page.bytes);
  expect(useDocumentStore.getState().genericForm).toEqual(instance);
  await flushDocumentWrites();
  expect((await idbFormDefinitions())?.some(definition => definition.pages[0].sha256 === page.sha256)).toBe(true);
  await removeUnusedPackages([]);
  expect(await packageAvailableOffline(instance.definition)).toBe(true);
});

it('deduplicates shared PDF bytes while retaining different exact form definitions', async () => {
  const { instance } = await source();
  const second = structuredClone(instance.definition);second.label = 'Another exact form revision';
  const bundle = (await capturePortableFormTemplates([instance.definition, second, instance.definition]))!;
  expect(bundle.portableFormTemplates).toHaveLength(2);
  expect(bundle.portableResources.entries).toHaveLength(1);
  const templates = await validatePortableFormTemplates([instance.definition, second], bundle.portableFormTemplates, bundle.portableResources);
  expect(templates.map(item => item.definition.label)).toEqual([instance.definition.label, second.label]);
});

it.each(['missing', 'bytes', 'definition', 'binding', 'dimensions', 'version', 'unexpected'] as const)('rejects %s template content before changing the current draft', async kind => {
  formCache();const { instance } = await source();openFormInstance(instance);
  const exported = JSON.parse(JSON.stringify(await buildDraftFile()));
  if (kind === 'missing') exported.portableResources.entries = [];
  if (kind === 'bytes') exported.portableResources.entries[0].data = 'AAAA';
  if (kind === 'definition') exported.genericForm.definition.label = 'Tampered definition';
  if (kind === 'binding') exported.portableFormTemplates[0].pages['page1.pdf'] = `forms/${'a'.repeat(64)}.pdf`;
  if (kind === 'dimensions') {
    exported.genericForm.definition.pages[0].width = 700;
    exported.portableFormTemplates[0].definitionSha256 = await digest(new TextEncoder().encode(JSON.stringify(exported.genericForm.definition)));
  }
  if (kind === 'version') exported.portableFormTemplates[0].version = 2;
  if (kind === 'unexpected') exported.portableResources.entries.push({ ...exported.portableResources.entries[0], path: `forms/${'b'.repeat(64)}.pdf` });
  const before = useDocumentStore.getState().getSnapshot();
  await expect(parsePortableDraft(exported)).rejects.toThrow();
  expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
});

it('requires both manifest sections for new drafts and keeps legacy definition-only files readable', async () => {
  const { instance } = await source();
  expect(parseDraftFile({ version: '2.0', genericForm: instance }).session.genericForm).toEqual(instance);
  const draft = { documentMode: 'compliant', documentCategory: 'forms', docType: 'naval_letter', formType: instance.definition.formId,
    genericForm: instance, formData: {}, references: [], enclosures: [], paragraphs: [], copyTos: [], kind: 'dondocs-draft', version: 3, documentKind: 'configured-form' };
  await expect(parsePortableDraft(draft)).rejects.toThrow(/missing/);
});

it('refuses failed durable imports and leaves the owning draft unchanged', async () => {
  formCache();const { instance } = await source();openFormInstance(instance);
  const reviewed = await parsePortableDraft(await buildDraftFile());
  const before = useDocumentStore.getState().getSnapshot();const id = useDocumentsStore.getState().currentId;
  vi.spyOn(db, 'idbPutAttachment').mockResolvedValue(false);
  await expect(openReviewedDocument(reviewed, captureDocumentTarget())).rejects.toThrow(/storage/);
  expect(useDocumentsStore.getState().currentId).toBe(id);
  expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
});

it('does not activate a staged form when its document metadata cannot commit', async () => {
  formCache();const { instance } = await source();openFormInstance(instance);await flushDocumentWrites();
  const reviewed = await parsePortableDraft(await buildDraftFile());
  const id = useDocumentsStore.getState().currentId, before = useDocumentStore.getState().getSnapshot();
  vi.spyOn(db, 'idbWriteDocument').mockResolvedValue('failed');
  await expect(openReviewedDocument(reviewed, captureDocumentTarget())).rejects.toThrow(/saved completely/);
  expect(useDocumentsStore.getState().currentId).toBe(id);expect(useDocumentStore.getState().getSnapshot()).toEqual(before);
});

it('does not publish a multi-page form after a late durable write failure or a changed target', async () => {
  const { instance, page } = await source();
  const second = await PDFDocument.load(page.bytes);second.setTitle('Second captured page');
  const secondBytes = await second.save();
  instance.definition.pages.push({ ...instance.definition.pages[0], file: 'page2.pdf', sha256: await digest(secondBytes) });
  formCache();const put = db.idbPutAttachment;
  const before = useDocumentsStore.getState().currentId;
  const writes = vi.spyOn(db, 'idbPutAttachment').mockImplementationOnce(put).mockResolvedValueOnce(false);
  await expect(retainPackagePages(instance.definition, { 'page1.pdf': page.bytes, 'page2.pdf': secondBytes })).rejects.toThrow(/retained/);
  expect((await idbReadAttachment(formTemplateAttachmentId(page.sha256))).status).toBe('found');
  expect((await idbReadAttachment(formTemplateAttachmentId(instance.definition.pages[1].sha256!))).status).toBe('missing');
  let current = true;
  writes.mockImplementationOnce(async (...args) => { const result = await put(...args);current = false;return result; });
  await expect(retainPackagePages(instance.definition, { 'page1.pdf': page.bytes, 'page2.pdf': secondBytes }, () => current)).resolves.toBe(false);
  expect(useDocumentsStore.getState().currentId).toBe(before);
});

it('does not exceed the accelerator cache limit when an existing hash-keyed body is corrupt and short', async () => {
  const { instance, page } = await source();const { cache, entries } = formCache();
  entries.set(`/__form_assets/${page.sha256}.pdf`, new Response('x'));
  entries.set('/__form_assets/unrelated.pdf', new Response('unrelated'));
  cache.match.mockImplementation(async key => {
    const pathname = new URL(typeof key === 'string' ? key : key instanceof URL ? key.href : key.url, 'http://localhost').pathname;
    if (pathname.endsWith('/unrelated.pdf')) return { arrayBuffer: async () => new ArrayBuffer(100 * 1024 * 1024 - page.bytes.byteLength + 1) } as Response;
    return entries.get(pathname)?.clone();
  });
  await expect(retainPackagePages(instance.definition, { 'page1.pdf': page.bytes })).resolves.toBe(true);
  expect(cache.put).not.toHaveBeenCalled();
  expect((await idbReadAttachment(formTemplateAttachmentId(page.sha256))).status).toBe('found');
});

it('backs up templates once and restores them before any workspace records are installed', async () => {
  formCache();const { instance } = await source();openFormInstance(instance);await flushDocumentWrites();
  const backup = JSON.parse(await buildBackup());
  expect(backup.version).toBe(11);expect(backup.portableResources.entries).toHaveLength(1);
  formCache();vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  const result = await restoreBackup(JSON.stringify(backup));
  expect(result.issues ?? []).toEqual([]);expect(await packageAvailableOffline(instance.definition)).toBe(true);
  const before = await idbGetAllDocuments();
  const corrupt = structuredClone(backup);corrupt.portableResources.entries[0].sha256 = 'a'.repeat(64);
  await expect(restoreBackup(JSON.stringify(corrupt))).rejects.toThrow(/checksum/);
  expect(await idbGetAllDocuments()).toEqual(before);
  const missing = structuredClone(backup);delete missing.portableResources;
  await expect(restoreBackup(JSON.stringify(missing))).rejects.toThrow();
  expect(await idbGetAllDocuments()).toEqual(before);
});

it('retains aged templates solely owned by saved history, then collects them after the last owner is removed', async () => {
  const { instance, page } = await source();
  const unique = await PDFDocument.load(page.bytes);unique.setTitle('History-only portable revision');
  const bytes = await unique.save(), hash = await digest(bytes);instance.definition.pages[0].sha256 = hash;
  const { entries } = formCache();
  entries.set(`/__form_assets/${hash}.pdf`, new Response(new Uint8Array(bytes), { headers: { 'X-Form-Cached-At': String(Date.now() - 2 * 86400000) } }));
  const session = { ...getSerializedSession(), documentCategory: 'forms' as const, formType: instance.definition.formId, genericForm: instance };
  const id = 'portable-history-owner';
  expect(await idbPutDocument({ id, meta: { id, title: 'History owner', docType: 'naval_letter', updatedAt: 1 }, session: getSerializedSession() })).toBe(true);
  expect(await idbSetSnapshots('portable-history-owner', [{ ts: 1, session }])).toBe(true);
  expect(await collectLiveAttachmentIds()).toContain(formTemplateAttachmentId(hash));
  await removeUnusedPackages([]);expect(entries.has(`/__form_assets/${hash}.pdf`)).toBe(true);
  expect(await idbSetSnapshots('portable-history-owner', [])).toBe(true);
  expect(await collectLiveAttachmentIds()).not.toContain(formTemplateAttachmentId(hash));
  await removeUnusedPackages([]);expect(entries.has(`/__form_assets/${hash}.pdf`)).toBe(false);
});

it('reopens exact retained templates when the accelerator cache is unavailable', async () => {
  const { instance, page } = await source();formCache();
  expect(await retainPackagePages(instance.definition, { 'page1.pdf': page.bytes })).toBe(true);
  vi.stubGlobal('caches', { open: async () => { throw new Error('Cache unavailable after reload'); } });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  expect(await packageAvailableOffline(instance.definition)).toBe(true);
});

it('does not collect any aged page when persisted definition ownership cannot be read', async () => {
  const { entries } = formCache();const hash = 'c'.repeat(64);
  entries.set(`/__form_assets/${hash}.pdf`, new Response('retained', { headers: { 'X-Form-Cached-At': String(Date.now() - 2 * 86400000) } }));
  vi.spyOn(db, 'idbFormDefinitions').mockResolvedValueOnce(null);
  await removeUnusedPackages([]);expect(entries.has(`/__form_assets/${hash}.pdf`)).toBe(true);
});
