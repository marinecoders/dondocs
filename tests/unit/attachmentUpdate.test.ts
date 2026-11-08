import { expect, it, vi } from 'vitest';
import { persistAttachment, flushAttachmentWrites, loadAttachment } from '@/lib/attachments';
import { idbPutAttachment, idbGetAttachment } from '@/lib/documentsDb';
vi.mock('@/lib/documentsDb', () => ({ idbPutAttachment: vi.fn(), idbGetAttachment: vi.fn(), idbGetAllAttachments: vi.fn() }));

it('rejects an undurable handle while keeping caller bytes available for an explicit retry', async () => {
  vi.mocked(idbPutAttachment).mockResolvedValue(false);
  const bytes = new Uint8Array([0, 1, 254, 255]).buffer;
  const meta = { name: 'sample.bin', size: 4, type: 'application/octet-stream' };
  await expect(persistAttachment(meta, bytes)).rejects.toThrow('Could not save sample.bin');
  expect([...new Uint8Array(bytes)]).toEqual([0, 1, 254, 255]);
  await expect(flushAttachmentWrites()).resolves.toBeUndefined();
  vi.mocked(idbPutAttachment).mockResolvedValue(true);
  const ref = await persistAttachment(meta, bytes);
  vi.mocked(idbGetAttachment).mockResolvedValue({ id: ref.id, name: ref.name, type: ref.type, size: 4, data: bytes });
  expect(await loadAttachment(ref.id)).toEqual(bytes);
});

it('waits for an in-flight attachment transaction without issuing a duplicate write', async () => {
  vi.mocked(idbPutAttachment).mockClear();
  let finish!: (value: boolean) => void;
  vi.mocked(idbPutAttachment).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const writing = persistAttachment({ name: 'sample.bin', size: 1, type: '' }, new Uint8Array([1]).buffer);
  let flushed = false;
  const flushing = flushAttachmentWrites().then(() => { flushed = true; });
  await Promise.resolve(); expect(flushed).toBe(false);
  finish(true); await writing; await flushing;
  expect(flushed).toBe(true); expect(idbPutAttachment).toHaveBeenCalledOnce();
});

it('waits for a rejected attachment write without blocking subsequent updates for the unchanged draft', async () => {
  let finish!: (stored: boolean) => void;
  vi.mocked(idbPutAttachment).mockClear().mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const writing = persistAttachment(
    { name: 'rejected.pdf', size: 1, type: 'application/pdf' },
    new Uint8Array([1]).buffer,
  );
  const rejected = expect(writing).rejects.toThrow('Could not save rejected.pdf');
  let flushed = false;
  const flushing = flushAttachmentWrites().then(() => { flushed = true; });
  await Promise.resolve();
  expect(flushed).toBe(false);
  finish(false);
  await rejected;
  await flushing;
  expect(flushed).toBe(true);

  await expect(flushAttachmentWrites()).resolves.toBeUndefined();
  expect(idbPutAttachment).toHaveBeenCalledOnce();
});
