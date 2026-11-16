import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { fixtureInstance } from '../_helpers/formFixture';
import { portableResourceDigest } from '@/lib/portableResources';
import { uint8ArrayToBase64 } from '@/lib/encoding';
import { createBlankSession } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { capturePackageMember, captureOriginalPackageMember, readPackageMemberDraft } from '@/lib/actionPackageAssets';
import { createActionPackage, getPackageRevision, listActionPackages, packageAssets, reviseActionPackage } from '@/lib/actionPackages';
import { idbDeleteAttachment } from '@/lib/documentsDb';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { capturePackageTemplate, deletePackageTemplate, exportPackageTemplate, importPackageTemplate, instantiatePackageTemplate,
  listPackageTemplates, packageTemplatePlaceholders, renamePackageTemplate, validatePackageTemplate, validatePackageTemplateLibrary } from '@/lib/packageTemplateLibrary';

vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn(), useBackupStore: { getState: () => ({}) } }));
async function clearDb() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  if (db.objectStoreNames.length) await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([...db.objectStoreNames], 'readwrite');
    for (const name of db.objectStoreNames) transaction.objectStore(name).clear();
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}
async function fixture() {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]); const data = new Uint8Array(await pdf.save()).buffer;
  const session = createBlankSession();
  session.formData = { ...session.formData, subject: 'Action for {{NAME}}', signatureType: 'digital' };
  session.paragraphs = [{ id: 'original-paragraph', referenceId: 'stable-cross-reference', text: 'Approve {{NAME}}.', level: 0 }];
  const native = await capturePackageMember(captureDocumentRevision({ documentId: 'source', epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...session, endItems: [], publicationTables: {} }), 'Letter for {{NAME}}', 'basic-letter');
  const original = await captureOriginalPackageMember({ name: 'Previous signed enclosure.pdf', data }, 'enclosure', true);
  original.label = '{{ATTACHMENT_LABEL}}';
  const record = await reviseActionPackage(await createActionPackage('Source action'), [native, original]);
  return { record, native, data };
}
beforeEach(async () => { await listActionPackages(); await clearDb(); useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true }); useUIStore.setState({ storageHealth: 'ok' }); });
describe('reusable package starters', () => {
  it('owns starter bytes, order, roles and fresh attachment requirements after reload', async () => {
    const { record } = await fixture();
    const template = await capturePackageTemplate(record, record.currentRevisionId, 'Reusable action');
    expect(await listPackageTemplates()).toEqual([template]);
    expect(template.members.map(member => [member.kind, member.role])).toEqual([['native', 'basic-letter'], ['attachment', 'enclosure']]);
    expect(JSON.stringify(template)).not.toContain('Previous signed enclosure.pdf');
    expect(template.members[0].kind === 'native' && template.members[0].draft.formData).toMatchObject({ signatureType: 'none' });
    expect(packageTemplatePlaceholders(template)).toEqual(['ATTACHMENT_LABEL', 'NAME']);
    for (const asset of packageAssets(record)) await idbDeleteAttachment(asset.id);
    expect(await listPackageTemplates()).toEqual([template]);
  });
  it('creates separate identities, substitutions and fresh files without rewriting source or template', async () => {
    const { record, data } = await fixture();
    const before = structuredClone(record);
    const template = await capturePackageTemplate(record, record.currentRevisionId, 'Reusable action');
    const first = await instantiatePackageTemplate(template, 'First action', { NAME: 'First Marine', ATTACHMENT_LABEL: 'Fresh supporting PDF' }, { 1: { name: 'fresh.pdf', data, signedOriginal: false } });
    const second = await instantiatePackageTemplate(template, 'Second action', { NAME: 'Second Marine', ATTACHMENT_LABEL: 'Second PDF' }, { 1: { name: 'second.pdf', data, signedOriginal: true } });
    expect(first.id).not.toBe(second.id);
    const member = getPackageRevision(first).members[0];
    expect(member.kind).toBe('native');
    if (member.kind !== 'native') throw new Error('Missing native starter');
    expect(member.source).toBeUndefined();
    expect(member.session.paragraphs[0]).toMatchObject({ text: 'Approve First Marine.', referenceId: 'stable-cross-reference' });
    expect(member.session.paragraphs[0].id).not.toBe('original-paragraph');
    expect(member.id).not.toBe(getPackageRevision(second).members[0].id);
    expect(member.session.paragraphs[0].id).not.toBe((getPackageRevision(second).members[0] as typeof member).session.paragraphs[0].id);
    expect(member.session.formData.signatureType).toBe('none');
    expect(first.reviewRounds).toBeUndefined(); expect(first.workingCopies).toBeUndefined();
    expect(getPackageRevision(first).outputs).toEqual([]);
    expect((await readPackageMemberDraft(member)).reviewed.session).toEqual(member.session);
    expect((await listActionPackages()).find(value => value.id === record.id)).toEqual(before);
    expect((await listPackageTemplates())[0]).toEqual(template);
  });
  it('still instantiates after source package assets have been deleted', async () => {
    const { record, data } = await fixture();
    const template = await capturePackageTemplate(record, record.currentRevisionId, 'Independent starter');
    for (const asset of packageAssets(record)) await idbDeleteAttachment(asset.id);
    const created = await instantiatePackageTemplate(template, 'Independent action', { NAME: 'Fresh Marine', ATTACHMENT_LABEL: 'Fresh file' }, { 1: { name: 'fresh.pdf', data, signedOriginal: false } });
    expect(getPackageRevision(created).members).toHaveLength(2);
  });
  it('rejects missing inputs and required files before publishing a package', async () => {
    const { record } = await fixture(); const template = await capturePackageTemplate(record, record.currentRevisionId, 'Required inputs');
    await expect(instantiatePackageTemplate(template, 'Missing input', {}, {})).rejects.toThrow('Supply a fresh value');
    await expect(instantiatePackageTemplate(template, 'Missing PDF', { NAME: 'New Marine', ATTACHMENT_LABEL: 'New PDF' }, {})).rejects.toThrow('Attach a fresh PDF');
    await expect(instantiatePackageTemplate(template, 'Recursive value', { NAME: '{{NAME}}', ATTACHMENT_LABEL: 'New PDF' }, {})).rejects.toThrow('Supply a fresh value');
    expect(await listActionPackages()).toHaveLength(1);
  });
  it('rejects invalid returned bytes and unknown attachment slots', async () => {
    const { record, data } = await fixture(); const template = await capturePackageTemplate(record, record.currentRevisionId, 'File checks');
    const values = { NAME: 'New Marine', ATTACHMENT_LABEL: 'New PDF' };
    await expect(instantiatePackageTemplate(template, 'Invalid PDF', values, { 1: { name: 'bad.pdf', data: new Uint8Array([1, 2]).buffer, signedOriginal: false } })).rejects.toThrow();
    await expect(instantiatePackageTemplate(template, 'Unknown slot', values, { 1: { name: 'fresh.pdf', data, signedOriginal: false }, 99: { name: 'extra.pdf', data, signedOriginal: false } })).rejects.toThrow('does not belong');
    expect(await listActionPackages()).toHaveLength(1);
  });
  it('rejects oversized fresh-file selections before cloning or publishing their bytes', async () => {
    const { record } = await fixture(); const template = await capturePackageTemplate(record, record.currentRevisionId, 'Bounded action');
    template.members.push(structuredClone(template.members[1]), structuredClone(template.members[1]));
    const files = Object.fromEntries([1, 2, 3].map(index => [index, { name: `fresh-${index}.pdf`, data: new ArrayBuffer(22 * 1024 * 1024), signedOriginal: false }]));
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      await expect(instantiatePackageTemplate(template, 'Oversized action', { NAME: 'New Marine', ATTACHMENT_LABEL: 'New PDF' }, files)).rejects.toThrow('combined 64 MB limit');
      expect(clone.mock.calls.some(([value]) => value === files)).toBe(false);
      expect(await listActionPackages()).toHaveLength(1);
    } finally { clone.mockRestore(); }
  });
  it('renames and deletes conditionally, preserving edits from another tab', async () => {
    const { record } = await fixture(); const template = await capturePackageTemplate(record, record.currentRevisionId, 'First name');
    const renamed = await renamePackageTemplate(template, 'New name');
    await expect(renamePackageTemplate(template, 'Stale overwrite')).rejects.toThrow('changed');
    await expect(deletePackageTemplate(template)).rejects.toThrow('changed');
    expect(await listPackageTemplates()).toEqual([renamed]);
    await deletePackageTemplate(renamed); expect(await listPackageTemplates()).toEqual([]);
  });
  it('exports and imports a self-contained template under a new identity', async () => {
    const { record } = await fixture(); const template = await capturePackageTemplate(record, record.currentRevisionId, 'Portable starter');
    const json = await exportPackageTemplate(template);
    await clearDb();
    const imported = await importPackageTemplate(json);
    expect(imported.id).not.toBe(template.id); expect(imported.members).toEqual(template.members);
    expect(await listPackageTemplates()).toEqual([imported]);
  });
  it('checks current import authority at the final storage boundary', async () => {
    const { record } = await fixture(); const template = await capturePackageTemplate(record, record.currentRevisionId, 'Guarded starter');
    const json = await exportPackageTemplate(template);
    await expect(importPackageTemplate(json, undefined, () => false)).rejects.toThrow('changed');
    expect(await listPackageTemplates()).toEqual([template]);
  });
  it('refuses tampered signatures, malformed models and duplicate recovery identities', async () => {
    const { record } = await fixture(); const template = await capturePackageTemplate(record, record.currentRevisionId, 'Valid starter');
    const tampered = structuredClone(template);
    if (tampered.members[0].kind !== 'native') throw new Error('Missing native starter');
    (tampered.members[0].draft.formData as Record<string, unknown>).signatureType = 'digital';
    await expect(validatePackageTemplate(tampered)).rejects.toThrow('prior signatures');
    await expect(validatePackageTemplate({ ...template, extra: true })).rejects.toThrow();
    await expect(validatePackageTemplate({ ...template, members: [] })).rejects.toThrow();
    await expect(validatePackageTemplateLibrary([template, template])).rejects.toThrow('Duplicate');
  });
  it('binds distinct form page filenames without normalized identity collisions', async () => {
    const firstPdf = await PDFDocument.create(); firstPdf.addPage([612, 792]); firstPdf.setTitle('First');
    const secondPdf = await PDFDocument.create(); secondPdf.addPage([612, 792]); secondPdf.setTitle('Second');
    const first = await firstPdf.save(), second = await secondPdf.save();
    const instance = fixtureInstance();
    instance.definition.pages = [
      { file: 'a.b.pdf', width: 612, height: 792, sha256: await portableResourceDigest(new Uint8Array(first).buffer) },
      { file: 'a_b.pdf', width: 612, height: 792, sha256: await portableResourceDigest(new Uint8Array(second).buffer) },
    ];
    const session = { ...createBlankSession(), documentCategory: 'forms' as const, formType: 'fixture', genericForm: instance };
    const template = await validatePackageTemplate({ kind: 'dondocs-package-template', version: 1, id: 'two_pages', name: 'Two page starter', createdAt: 0,
      members: [{ kind: 'native', label: 'Form', role: 'supporting-document', required: true, draft: { ...session, timestamp: 0 },
        pages: { 'a.b.pdf': { name: 'a.b.pdf', type: 'application/pdf', data: uint8ArrayToBase64(first) },
          'a_b.pdf': { name: 'a_b.pdf', type: 'application/pdf', data: uint8ArrayToBase64(second) } } }],
    });
    expect(template.members).toHaveLength(1);
    const created = await instantiatePackageTemplate(template, 'Fresh form action', {}, {});
    expect(getPackageRevision(created).members).toHaveLength(1);
  });
  it('does not publish after cancellation', async () => {
    const { record, data } = await fixture(); const template = await capturePackageTemplate(record, record.currentRevisionId, 'Cancellation');
    const controller = new AbortController(); controller.abort();
    await expect(instantiatePackageTemplate(template, 'Cancelled action', { NAME: 'New Marine', ATTACHMENT_LABEL: 'New PDF' }, { 1: { name: 'fresh.pdf', data, signedOriginal: false } }, controller.signal)).rejects.toThrow();
    expect(await listActionPackages()).toHaveLength(1);
  });
  it('includes the independent template library in workspace backup and restores it', async () => {
    const { record } = await fixture(); const template = await capturePackageTemplate(record, record.currentRevisionId, 'Backed up starter');
    const json = await buildBackup(); const backup = JSON.parse(json);
    expect(backup.version).toBe(13); expect(backup.packageTemplates).toEqual([template]);
    await clearDb();
    const restored = await restoreBackup(json);
    expect(restored.packageTemplatesRestored).toBe(1); expect(await listPackageTemplates()).toEqual([template]);
  });
});
