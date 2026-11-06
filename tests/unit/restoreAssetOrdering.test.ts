import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { restoreBackup } from '@/lib/backup';
import * as db from '@/lib/documentsDb';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
const file = { id: 'restore-owned', name: 'file.pdf', type: 'application/pdf', size: 1, data: btoa('x') };
function document(id: string, asset = true) {
  return { id, meta: { id, title: id, updatedAt: 1, docType: 'naval_letter' }, session: { docType: 'naval_letter', formData: {}, paragraphs: [], references: [], enclosures: asset ? [{ title: 'PDF', fileRef: { id: file.id, name: file.name, size: file.size, type: file.type } }] : [], copyTos: [], distributions: [] } };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
  useDocumentStore.getState().resetForm();
  for (const record of await db.idbGetAllDocuments() ?? []) await db.idbDeleteDocument(record.id);
  await db.idbDeleteAttachment(file.id);
});
afterEach(() => vi.restoreAllMocks());
it('does not publish dependent documents or history until their bytes commit', async () => {
  const actualWrite = db.idbWriteDocument;
  const write = vi.spyOn(db, 'idbWriteDocument').mockImplementation(async (before, after) => {
    expect((await db.idbGetAttachment(file.id))?.data.byteLength).toBe(1);
    return actualWrite(before, after);
  });
  const result = await restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [document('ordered')], attachments: [file] }));
  expect(write).toHaveBeenCalled(); expect(result.documents.imported).toBe(1);
});
it('skips a document and history with failed assets while restoring independent work', async () => {
  const put = vi.spyOn(db, 'idbPutAttachment').mockResolvedValueOnce(false);
  const failed = document('requires-file');
  const result = await restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [failed, document('healthy', false)], attachments: [file], snapshots: { 'requires-file': [{ ts: 1, session: failed.session }] } }));
  expect(result.documents).toMatchObject({ imported: 1, skipped: 1 });
  expect((await db.idbGetAllDocuments())!.map(record => record.id)).toEqual(['healthy']);
  expect(await db.idbGetSnapshots('requires-file')).toEqual([]); expect(result.issues).toContain(`Attachment ${file.id} could not be saved`);
  put.mockRestore();
});
it('does not attach incoming documents to colliding local bytes', async () => {
  await db.idbPutAttachment({ ...file, data: new Uint8Array([2]).buffer });
  const result = await restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [document('collision')], attachments: [file] }));
  expect(result.documents.imported).toBe(0); expect(await db.idbGetAllDocuments()).toEqual([]);
  expect(new Uint8Array((await db.idbGetAttachment(file.id))!.data)[0]).toBe(2);
});
it('validates duplicate identities before writing staged resources', async () => {
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [document('duplicate'), document('duplicate')], attachments: [file] }))).rejects.toThrow('Duplicate');
  expect(await db.idbGetAttachment(file.id)).toBeNull();
});
it('does not replace another document form buffer after navigation during staging', async () => {
  const { useFormStore } = await import('@/stores/formStore');
  const { flushDocumentWrites } = await import('@/stores/documentsStore');
  useDocumentsStore.getState().newDocument('navmc_118_11');
  const original = db.idbPutAttachment;
  let release!: () => void, entered!: () => void;
  const staging = new Promise<void>(done => { entered = done; });
  vi.spyOn(db, 'idbPutAttachment').mockImplementationOnce(async (...args) => {
    entered(); await new Promise<void>(done => { release = done; }); return original(...args);
  });
  const restoring = restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [document('restored')], attachments: [file], forms: { navmc11811: { remarksText: 'FROM BACKUP' } } }));
  await staging;
  useDocumentsStore.getState().newDocument('navmc_118_11');
  useFormStore.getState().setNavmc11811Field('remarksText', 'NEW DOCUMENT');
  release(); const result = await restoring;
  expect(useFormStore.getState().navmc11811.remarksText).toBe('NEW DOCUMENT');
  expect(result.formsRestored).toBe(false);
  expect(result.issues).toContain('Form fields were not replaced because the open document changed during restore');
  await flushDocumentWrites();
});
it.each(['__proto__', 'constructor'])('rejects reserved document identity %s before staging', async id => {
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [document(id)], attachments: [file] }))).rejects.toThrow('Invalid document');
  expect(await db.idbGetAttachment(file.id)).toBeNull();
});
it('rejects an unsupported backup version before staging or publishing resources', async () => {
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', version: 999, documents: [document('future')], attachments: [file] }))).rejects.toThrow('Unsupported backup version');
  expect(await db.idbGetAttachment(file.id)).toBeNull(); expect(await db.idbGetAllDocuments()).toEqual([]);
});
it('reports and skips legacy attached-file flags with no recoverable asset identity', async () => {
  const legacy = document('legacy-attachment', false);
  legacy.session.enclosures = [{ title: 'Missing', hasFile: true }] as unknown as typeof legacy.session.enclosures;
  const result = await restoreBackup(JSON.stringify({ kind: 'dondocs-library', version: 1, docs: [legacy] }));
  expect(result.documents).toMatchObject({ imported: 0, skipped: 1 });
  expect(result.issues).toContain('An enclosure file is missing from this backup; its dependent record was not restored');
  expect(await db.idbGetAllDocuments()).toEqual([]);
});
