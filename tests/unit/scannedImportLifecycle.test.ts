import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
const engine = vi.hoisted(() => ({ initialize: vi.fn(), recognize: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/localOcrWorker', () => ({ LocalOcrWorker: class { initialize = engine.initialize; recognize = engine.recognize; close = engine.close; } }));
vi.mock('react-pdf', () => ({ pdfjs: { GlobalWorkerOptions: {}, version: 'test', getDocument: vi.fn() } }));
import { recognizeScannedFile } from '@/lib/scannedImport';
beforeEach(() => { vi.resetAllMocks(); });
it('rejects oversized photos before reading their encoded bytes', async () => {
  const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'too-large.png', { type: 'image/png' });
  const read = vi.spyOn(file, 'arrayBuffer');
  await expect(recognizeScannedFile(file, new AbortController().signal, vi.fn())).rejects.toThrow('10 MB');
  expect(read).not.toHaveBeenCalled();
  expect(engine.initialize).not.toHaveBeenCalled();
});
it('does not start bitmap decoding when cancelled as worker initialization completes', async () => {
  const controller = new AbortController();
  engine.initialize.mockImplementation(async () => { controller.abort(); });
  const bitmap = { width: 1, height: 1, close: vi.fn() };
  const decode = vi.fn().mockResolvedValue(bitmap); vi.stubGlobal('createImageBitmap', decode);
  const bytes = await readFile(resolve('tests/fixtures/images/business-figure-baseline.jpg'));
  await expect(recognizeScannedFile(new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' }), controller.signal, vi.fn())).rejects.toMatchObject({ name: 'AbortError' });
  expect(decode).not.toHaveBeenCalled(); expect(engine.close).toHaveBeenCalledOnce();
});
