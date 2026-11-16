import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalOcrWorker } from '@/lib/localOcrWorker';

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(public url: string) { WorkerDouble.instances.push(this); }
  reply(status: string, data: unknown, jobId = String(this.postMessage.mock.calls.length)) {
    this.onmessage?.({ data: { status, jobId, data } } as MessageEvent);
  }
}
beforeEach(() => { vi.stubGlobal('Worker', WorkerDouble); WorkerDouble.instances = []; });

describe('pinned local OCR worker adapter', () => {
  it('uses only same-origin paths and initializes the pinned English LSTM protocol', async () => {
    const signal = new AbortController();
    const progress = vi.fn();
    const engine = new LocalOcrWorker(signal.signal, progress);
    const worker = WorkerDouble.instances[0];
    expect(new URL(worker.url).origin).toBe(window.location.origin);
    expect(worker.url).toContain('/lib/ocr/7.0.0/worker.min.js');
    const ready = engine.initialize();
    expect(worker.postMessage.mock.calls[0][0]).toMatchObject({ action: 'load', payload: { options: { lstmOnly: true } } });
    worker.reply('resolve', {}); await Promise.resolve();
    expect(worker.postMessage.mock.calls[1][0]).toMatchObject({ action: 'loadLanguage', payload: { langs: ['eng'], options: { cacheMethod: 'none', gzip: true } } });
    worker.reply('resolve', {}); await Promise.resolve();
    expect(worker.postMessage.mock.calls[2][0]).toMatchObject({ action: 'initialize', payload: { oem: 1 } });
    worker.reply('resolve', {}); await ready;
    const result = engine.recognize(new Uint8Array([1, 2]));
    worker.reply('progress', { progress: 0.5 });
    expect(progress).toHaveBeenCalledWith(0.5);
    worker.reply('resolve', { text: 'Subj: TEST', confidence: 95 });
    await expect(result).resolves.toEqual({ text: 'Subj: TEST', confidence: 95 });
    engine.close(); expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates immediately when cancelled during initialization and ignores late messages', async () => {
    const abort = new AbortController();
    const progress = vi.fn();
    const engine = new LocalOcrWorker(abort.signal, progress);
    const ready = engine.initialize();
    const assertion = expect(ready).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await assertion;
    const worker = WorkerDouble.instances[0];
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.reply('progress', { progress: 1 });
    expect(progress).not.toHaveBeenCalled();
    engine.close(); expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects a failed worker or worker command without leaving pending work', async () => {
    const engine = new LocalOcrWorker(new AbortController().signal, vi.fn());
    const ready = engine.initialize();
    const assertion = expect(ready).rejects.toThrow('could not read');
    WorkerDouble.instances[0].reply('reject', 'bad engine'); await assertion;
    expect(WorkerDouble.instances[0].terminate).toHaveBeenCalledOnce();
    await expect(engine.recognize(new Uint8Array())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects malformed confidence/text and caps returned text', async () => {
    const engine = new LocalOcrWorker(new AbortController().signal, vi.fn());
    const result = engine.recognize(new Uint8Array());
    const assertion = expect(result).rejects.toThrow('invalid text');
    WorkerDouble.instances[0].reply('resolve', { text: 'text', confidence: NaN });
    await assertion; engine.close();
  });

  it('fails a hung initialization with a bounded timeout', async () => {
    vi.useFakeTimers();
    try {
      const engine = new LocalOcrWorker(new AbortController().signal, vi.fn());
      const assertion = expect(engine.initialize()).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(90_000); await assertion;
      expect(WorkerDouble.instances[0].terminate).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
