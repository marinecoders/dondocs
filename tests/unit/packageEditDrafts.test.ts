import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { openPackageEditDraft, packageEditDraftScope } from '@/lib/packageEditDrafts';
import { Blob as NodeBlob } from 'node:buffer';

const scope = (revision = 'version-1') => packageEditDraftScope(crypto.randomUUID(), revision, 'information');

it('recovers incomplete lexical values without changing them', async () => {
  const key = scope(), writer = await openPackageEditDraft(key);
  const value = { date: '2026-11-', identifier: '000123', answer: false };
  await writer.save(value);
  expect((await openPackageEditDraft(key)).value).toEqual(value);
});

it('keeps drafts scoped to their exact package revision and area', async () => {
  const id = crypto.randomUUID();
  await (await openPackageEditDraft(packageEditDraftScope(id, 'version-1', 'information'))).save({ subject: 'unfinished' });
  expect((await openPackageEditDraft(packageEditDraftScope(id, 'version-2', 'information'))).value).toBeNull();
  expect((await openPackageEditDraft(packageEditDraftScope(id, 'version-1', 'intake'))).value).toBeNull();
});

it('refuses to overwrite a newer draft written by another window', async () => {
  const key = scope(), first = await openPackageEditDraft(key), second = await openPackageEditDraft(key);
  await first.save({ subject: 'newer draft' });
  await expect(second.save({ subject: 'stale draft' })).rejects.toThrow('Another window changed this draft');
  expect((await openPackageEditDraft(key)).value).toEqual({ subject: 'newer draft' });
});

it('waits for pending writes before reopening the same draft', async () => {
  const key = scope(), writer = await openPackageEditDraft(key);
  const first = writer.save({ subject: 'first' }), second = writer.save({ subject: 'second' });
  const reopened = await openPackageEditDraft(key);
  await Promise.all([first, second]);
  expect(reopened.value).toEqual({ subject: 'second' });
});

it('captures values before asynchronous persistence and only clears its own draft', async () => {
  const key = scope(), writer = await openPackageEditDraft(key), value = { subject: 'captured' };
  const pending = writer.save(value); value.subject = 'later mutation'; await pending;
  expect((await openPackageEditDraft(key)).value).toEqual({ subject: 'captured' });
  const newer = await openPackageEditDraft(key); await newer.save({ subject: 'other window' });
  await expect(writer.save(null)).rejects.toThrow('Another window changed this draft');
  expect((await openPackageEditDraft(key)).value).toEqual({ subject: 'other window' });
  await newer.save(null);
  expect((await openPackageEditDraft(key)).value).toBeNull();
});

it('retains immutable file bytes alongside unfinished answers', async () => {
  const key = scope(), writer = await openPackageEditDraft(key);
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
  await writer.save({ answer: 'unfinished', file: new NodeBlob([bytes]) });
  bytes.fill(0);
  const value = (await openPackageEditDraft(key)).value as { answer: string; file: NodeBlob };
  expect(value.answer).toBe('unfinished');
  expect([...new Uint8Array(await value.file.arrayBuffer())]).toEqual([37, 80, 68, 70, 45, 49]);
});

it('preserves an unreadable draft until it is explicitly discarded', async () => {
  const key = scope(); await openPackageEditDraft(key);
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const transaction = db.transaction('app', 'readwrite'); transaction.objectStore('app').put({ key: `package-edit:${key}`, value: { token: 42, value: { unexpected: true } } }); transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
  db.close();
  const draft = await openPackageEditDraft(key);
  expect(draft.error).toContain('could not be read');
  await expect(draft.save({ replacement: true })).rejects.toThrow('Discard the unreadable');
  expect((await openPackageEditDraft(key)).error).toBeTruthy();
  await draft.save(null);
  expect((await openPackageEditDraft(key)).error).toBe('');
});
