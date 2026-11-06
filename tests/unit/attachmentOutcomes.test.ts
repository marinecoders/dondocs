import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import * as db from '@/lib/documentsDb';
import { persistAttachment, readAttachment } from '@/lib/attachments';
import { persistUnsavedEnclosures, useDocumentStore } from '@/stores/documentStore';
afterEach(() => vi.restoreAllMocks());
it('never returns a durable handle when the byte transaction fails', async () => {
  vi.spyOn(db, 'idbPutAttachment').mockResolvedValueOnce(false);
  await expect(persistAttachment({ name: 'failed.pdf', size: 1, type: 'application/pdf' }, new ArrayBuffer(1))).rejects.toThrow('Could not save failed.pdf');
});
it('owns bytes before its first asynchronous write', async () => {
  let finish!: (stored: boolean) => void;
  const write = vi.spyOn(db, 'idbPutAttachment').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const source = new Uint8Array([7]);
  const saving = persistAttachment({ name: 'owned.pdf', size: 1, type: '' }, source.buffer);
  source[0] = 9; expect(new Uint8Array(write.mock.calls[0][0].data)[0]).toBe(7);
  finish(true); await saving;
});
it('distinguishes a missing file, a failed read, and a successful retry', async () => {
  expect(await readAttachment('missing-strict')).toEqual({ status: 'missing' });
  const get = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementationOnce(() => { throw new Error('Denied'); });
  expect(await readAttachment('missing-strict')).toMatchObject({ status: 'failed', error: expect.any(Error) });
  get.mockRestore();
  const ref = await persistAttachment({ name: 'saved', size: 1, type: '' }, new Uint8Array([3]).buffer);
  expect(await readAttachment(ref.id)).toMatchObject({ status: 'found', attachment: { id: ref.id } });
});
it('keeps a legacy imported enclosure in memory without adding a false durable ref', async () => {
  vi.spyOn(db, 'idbPutAttachment').mockResolvedValueOnce(false);
  const file = { name: 'legacy.pdf', size: 1, data: new ArrayBuffer(1) };
  useDocumentStore.setState({ enclosures: [{ title: 'Legacy', file }] });
  await persistUnsavedEnclosures(() => true);
  expect(useDocumentStore.getState().enclosures[0].file).toBe(file);
  expect(useDocumentStore.getState().enclosures[0].fileRef).toBeUndefined();
});
