import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isRestoreInProgress, restoreBackup, restoreBackupFile } from '@/lib/backup';
import * as db from '@/lib/documentsDb';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';
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
it.each(['existing', 'concurrent'] as const)('recognizes equivalent attachment bytes with unpadded base64: %s', async state => {
  const record = { ...file, data: new Uint8Array([120]).buffer };
  if (state === 'existing') await db.idbPutAttachment(record);
  else {
    const put = db.idbPutAttachment;
    vi.spyOn(db, 'idbPutAttachment').mockImplementationOnce(async () => {
      await put(record);
      return false;
    });
  }
  const result = await restoreBackup(JSON.stringify({
    kind: 'dondocs-backup', documents: [document('same-bytes')], attachments: [{ ...file, data: 'eA' }],
  }));
  expect(result.documents).toMatchObject({ imported: 1, skipped: 0 });
  expect(result.issues).toBeUndefined();
  expect([...new Uint8Array((await db.idbGetAttachment(file.id))!.data)]).toEqual([120]);
});
it('validates duplicate identities before writing staged resources', async () => {
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [document('duplicate'), document('duplicate')], attachments: [file] }))).rejects.toThrow('Duplicate');
  expect(await db.idbGetAttachment(file.id)).toBeNull();
});
it('rejects a legacy library with no document list before staging resources', async () => {
  const write = vi.spyOn(db, 'idbPutAttachment');
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-library', version: 1, attachments: [file] }))).rejects.toThrow('Not a DonDocs library file');
  expect(write).not.toHaveBeenCalled();
  expect(await db.idbGetAllDocuments()).toEqual([]);
});
it.each([
  ['name', 42],
  ['type', { invalid: true }],
] as const)('rejects invalid attachment %s before staging or publishing', async (field, value) => {
  const write = vi.spyOn(db, 'idbPutAttachment');
  const backup = {
    kind: 'dondocs-backup',
    documents: [document('invalid-attachment')],
    attachments: [{ ...file, [field]: value }],
  };

  await expect(restoreBackup(JSON.stringify(backup))).rejects.toThrow('invalid metadata');
  expect(write).not.toHaveBeenCalled();
  expect(await db.idbGetAllDocuments()).toEqual([]);
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

it('restores historical asset-free templates whose source had an attached enclosure', async () => {
  const { getSerializedSessionForShare } = await import('@/stores/documentStore');
  const { useUserTemplatesStore } = await import('@/stores/userTemplatesStore');
  useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'naval_letter', enclosures: [{ title: 'Reference', file: { name: 'source.pdf', size: 1, data: new Uint8Array([1]).buffer } }] });
  useDocumentsStore.setState({ currentId: null, baseline: null, docs: {} });
  useUserTemplatesStore.setState({ templates: {} });
  const id = useUserTemplatesStore.getState().saveTemplate('Historical template', getSerializedSessionForShare());
  const templates = structuredClone(useUserTemplatesStore.getState().templates);
  expect(templates[id].session.enclosures[0]).toMatchObject({ hasFile: true });
  useUserTemplatesStore.setState({ templates: {} });
  const result = await restoreBackup(JSON.stringify({ kind: 'dondocs-backup', version: 5, documents: [], userTemplates: templates }));
  expect(result.templatesAdded).toBe(1);
  expect(useUserTemplatesStore.getState().templates[id].session.enclosures[0]).toMatchObject({ title: 'Reference', hasFile: false });
  expect(result.issues).toBeUndefined();
});

it.each(['edit', 'navigate'] as const)('keeps form changes made during the backup file read: %s', async change => {
  const { flushDocumentWrites } = await import('@/stores/documentsStore');
  useDocumentsStore.getState().newDocument('navmc_118_11');
  useFormStore.getState().setNavmc11811Field('remarksText', 'Before read');
  let finish!: (json: string) => void;
  const file = new Blob();
  vi.spyOn(file, 'text').mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const restoring = restoreBackupFile(file);
  expect(isRestoreInProgress()).toBe(true);
  if (change === 'navigate') useDocumentsStore.getState().newDocument('navmc_118_11');
  useFormStore.getState().setNavmc11811Field('remarksText', 'Changed during read');
  finish(JSON.stringify({ kind: 'dondocs-backup', documents: [], forms: { navmc11811: { remarksText: 'From backup' } } }));
  const result = await restoring;
  try {
    expect(result.formsRestored).toBe(false);
    expect(useFormStore.getState().navmc11811.remarksText).toBe('Changed during read');
    expect(result.issues).toContain('Form fields were not replaced because the open document changed during restore');
    expect(isRestoreInProgress()).toBe(false);
  } finally { await flushDocumentWrites(); }
});

it('rejects an invalid publication payload before staging otherwise valid bytes', async () => {
  const input = document('invalid-publication', false);
  input.session.formData = { manualFrontMatter: 123 };
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [input], attachments: [file] }))).rejects.toThrow();
  expect(await db.idbGetAttachment(file.id)).toBeNull();
  expect(await db.idbGetAllDocuments()).toEqual([]);
});

it('rejects history without a document identity before staging resources', async () => {
  const input = document('history-session', false);
  await expect(restoreBackup(JSON.stringify({
    kind: 'dondocs-backup', documents: [], attachments: [file], snapshots: { '': [{ ts: 1, session: input.session }] },
  }))).rejects.toThrow('Invalid history document identity');
  expect(await db.idbGetAttachment(file.id)).toBeNull();
  expect(await db.idbGetSnapshots('')).toEqual([]);
});

for (const location of ['enclosure', 'basic-letter', 'figure'] as const) {
  it.each([42, ''])(`rejects an invalid ${location} attachment identity before staging: %s`, async id => {
    const input = document('invalid-reference', false);
    const ref = { id, name: file.name, type: file.type, size: file.size };
    const session = {
      ...input.session,
      ...(location === 'enclosure' ? { enclosures: [{ title: 'Invalid', fileRef: ref }] } : {}),
      ...(location === 'basic-letter' ? { formData: { basicLetterFileRef: ref } } : {}),
      ...(location === 'figure' ? { paragraphs: [{ text: '', level: 0, figure: { fileRef: ref } }] } : {}),
    };
    await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [{ ...input, session }], attachments: [file] }))).rejects.toThrow('attachment reference');
    expect(await db.idbGetAttachment(file.id)).toBeNull();
    expect(await db.idbGetAllDocuments()).toEqual([]);
  });
}
