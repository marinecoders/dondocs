import { expect, it, vi } from 'vitest';
import { persistAttachment, flushAttachmentWrites, loadAttachment } from '@/lib/attachments';
import { idbPutAttachment, idbGetAttachment } from '@/lib/documentsDb';
vi.mock('@/lib/documentsDb', () => ({ idbPutAttachment: vi.fn(), idbGetAttachment: vi.fn(), idbGetAllAttachments: vi.fn() }));

it('retains failed attachment bytes for the session and retries persistence before updating', async () => {
  vi.mocked(idbPutAttachment).mockResolvedValue(false);
  const bytes = new Uint8Array([0, 1, 254, 255]).buffer;
  const ref = await persistAttachment({ name: 'sample.bin', size: 4, type: 'application/octet-stream' }, bytes);
  expect(await loadAttachment(ref.id)).toEqual(bytes);
  await expect(flushAttachmentWrites()).rejects.toThrow('could not be saved');
  vi.mocked(idbPutAttachment).mockResolvedValue(true);
  await flushAttachmentWrites();
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

it('rejects an undurable staged attachment without blocking updates for the unchanged draft', async () => {
  vi.mocked(idbPutAttachment).mockClear().mockResolvedValue(false);
  await expect(persistAttachment(
    { name: 'rejected.pdf', size: 1, type: 'application/pdf' },
    new Uint8Array([1]).buffer,
    { requireDurable: true },
  )).rejects.toThrow('Could not save rejected.pdf');

  await expect(flushAttachmentWrites()).resolves.toBeUndefined();
  expect(idbPutAttachment).toHaveBeenCalledOnce();
});
