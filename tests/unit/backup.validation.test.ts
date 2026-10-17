import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { importLibrary, useDocumentsStore } from '@/stores/documentsStore';
import { buildBackup, restoreBackup, summarizeRestore } from '@/lib/backup';
import * as db from '@/lib/documentsDb';
import { useUIStore } from '@/stores/uiStore';
import type { SerializedSession } from '@/stores/documentStore';
const record = (id: string, updatedAt = 1) => ({ id, meta: { id, title: id, updatedAt, createdAt: 1, docType: 'naval_letter' as const }, session: { formData: { subject: id }, enclosures: [] } as unknown as SerializedSession });
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const doc of await db.idbGetAllDocuments() ?? []) await db.idbDeleteDocument(doc.id);
  useDocumentsStore.setState({ docs: {}, currentId: null, baseline: null, hydrated: true });
  useUIStore.setState({ storageHealth: 'ok' });
});
it('rejects duplicate document IDs before writing any record', async () => {
  await expect(importLibrary(JSON.stringify({ docs: [record('a', 3), record('a', 2)] }))).rejects.toThrow('Duplicate');
  expect(await db.idbGetAllDocuments()).toEqual([]);
});
it('rejects mismatched record identity before writing any record', async () => {
  await expect(importLibrary(JSON.stringify({ docs: [record('a'), { ...record('b'), id: 'c' }] }))).rejects.toThrow('Invalid');
  expect(await db.idbGetAllDocuments()).toEqual([]);
});
it('does not overwrite another tab that saves after the restore read', async () => {
  const original = record('a', 1);
  await db.idbPutDocument(original);
  const actualWrite = db.idbWriteDocument;
  vi.spyOn(db, 'idbWriteDocument').mockImplementationOnce(async (...args) => {
    await db.idbPutDocument(record('a', 3));
    return actualWrite(...args);
  });
  const result = await importLibrary(JSON.stringify({ docs: [record('a', 2)] }));
  expect(result.issues?.[0]).toContain('changed during restore');
  expect((await db.idbGetAllDocuments())![0].meta.updatedAt).toBe(3);
});
it('rejects malformed attachment bytes before importing documents', async () => {
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [record('a')], attachments: [{ id: 'blob', data: '!!!!', size: 4 }] }))).rejects.toThrow();
  expect(await db.idbGetAllDocuments()).toEqual([]);
});
it('refuses an incomplete backup when referenced attachment bytes are absent', async () => {
  const doc = record('a');
  doc.session.enclosures = [{ fileRef: { id: 'missing' } }] as unknown as SerializedSession['enclosures'];
  useDocumentsStore.setState({ docs: { a: { meta: doc.meta, session: doc.session } } });
  await expect(buildBackup()).rejects.toThrow('Attachment missing');
});
it('reports failed attachment writes and permits retrying the same backup', async () => {
  const json = JSON.stringify({ kind: 'dondocs-backup', documents: [record('a')], attachments: [{ id: 'blob', data: btoa('bytes'), size: 5 }] });
  vi.spyOn(db, 'idbPutAttachment').mockResolvedValueOnce(false);
  const result = await restoreBackup(json);
  expect(summarizeRestore(result)).toContain('Partially restored');
  expect(result.issues).toContain('Attachment blob could not be saved');
  const retried = await restoreBackup(json);
  expect(retried.attachmentsAdded).toBe(1);
  expect(retried.issues).toBeUndefined();
});
it('merges restored history in the same transaction as its read', async () => {
  const old = { ts: 10, session: record('old').session };
  const concurrent = { ts: 20, session: record('concurrent').session };
  await db.idbDeleteSnapshots('history-race');
  await Promise.all([db.idbSetSnapshots('history-race', [old], true), db.idbAddSnapshot('history-race', concurrent)]);
  expect((await db.idbGetSnapshots('history-race')).map(snapshot => snapshot.ts)).toEqual([20, 10]);
});
it('does not replace attachment bytes added by another restore', async () => {
  const attachment = { id: 'immutable', name: 'bytes', type: '', size: 1, data: new Uint8Array([1]).buffer };
  await db.idbPutAttachment(attachment);
  expect(await db.idbPutAttachment({ ...attachment, data: new Uint8Array([2]).buffer }, true)).toBe(false);
  expect([...new Uint8Array((await db.idbGetAttachment('immutable'))!.data)]).toEqual([1]);
});
it('reports a referenced attachment that was absent from the backup', async () => {
  const doc = record('missing-reference');
  doc.session.enclosures = [{ fileRef: { id: 'absent-from-backup' } }] as unknown as SerializedSession['enclosures'];
  const result = await restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [doc] }));
  expect(result.issues).toContain('Attachment absent-from-backup is missing from the backup and local storage');
});
it.each([
  { documents: {} },
  { profiles: { profiles: { broken: { unitLine1: [] } } } },
  { snippets: [{ id: 'a', name: 'a', text: 'a' }, { id: 'a', name: 'b', text: 'b' }] },
  { userTemplates: { a: { id: 'a', session: [] } } },
  { forms: { navmc10274: { signatureBlocks: [null] } } },
  { forms: { configFormRows: { form: { rows: {} } } } },
  { routingOverrides: { route: 4 } },
])('rejects malformed sections before any document is imported: %j', async (invalid) => {
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [record('untouched')], ...invalid }))).rejects.toThrow();
  expect(await db.idbGetAllDocuments()).toEqual([]);
});
it.each(['dondocs_profiles', 'dondocs_snippets', 'dondocs_user_templates', 'dondocs-forms', 'dondocs_routing'])('reports %s persistence failure and continues restoring attachments', async (key) => {
  const { ACTION_ROUTING } = await import('@/data/actionRouting');
  const json = JSON.stringify({ kind: 'dondocs-backup', documents: [record(key)],
    profiles: { profiles: { 'quota-profile': { unitLine1: 'Restored' } }, selectedProfile: null },
    snippets: [{ id: 'quota-snippet', name: 'Restored', text: 'Restored' }],
    userTemplates: { 'quota-template': { id: 'quota-template', name: 'Restored', docType: 'naval_letter', createdAt: 1, session: record('a').session } },
    forms: { navmc10274: { from: 'Restored' } },
    routingOverrides: { [ACTION_ROUTING[0].id]: `Restored ${key}` },
    attachments: [{ id: `attachment-${key}`, data: btoa('bytes'), size: 5 }],
  });
  const setItem = localStorage.setItem.bind(localStorage);
  const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(function (this: Storage, name, value) {
    if (name === key) throw new DOMException('full', 'QuotaExceededError');
    return setItem(name, value);
  });
  const result = await restoreBackup(json);
  expect(result.issues?.some(issue => issue.includes('could not be saved'))).toBe(true);
  expect(result.attachmentsAdded).toBe(1);
  spy.mockRestore();
  expect((await restoreBackup(json)).issues).toBeUndefined();
  expect(localStorage.getItem(key)).not.toBeNull();
});
it('rejects excessive nesting without changing existing data', async () => {
  await db.idbPutDocument(record('existing'));
  let nested: unknown = {};
  for (let i = 0; i < 51; i++) nested = { nested };
  await expect(restoreBackup(JSON.stringify({ kind: 'dondocs-backup', documents: [record('new')], extra: nested }))).rejects.toThrow('complex');
  expect((await db.idbGetAllDocuments())?.map(doc => doc.id)).toEqual(['existing']);
});
it('restores an older backup with only the cover-page preference', async () => {
  const { useFormStore } = await import('@/stores/formStore');
  useFormStore.setState({ includeCoverPage: true });
  const result = await restoreBackup(JSON.stringify({ kind: 'dondocs-backup', forms: { includeCoverPage: false } }));
  expect(result.formsRestored).toBe(true);
  expect(useFormStore.getState().includeCoverPage).toBe(false);
});
