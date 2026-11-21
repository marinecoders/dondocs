/**
 * The engine's readiness deadline lives only as long as the wait it bounds.
 *
 * It used to be left armed after the worker reported ready, which kept the
 * server process alive for a full minute after the client had gone. And a
 * worker that missed the deadline was never terminated.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const workers = vi.hoisted(() => [] as Array<EventEmitter & { terminate: () => Promise<number>; postMessage: () => void }>);

vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    stdout = new PassThrough();
    stderr = new PassThrough();
    postMessage = vi.fn();
    terminate = vi.fn(async () => 0);
    constructor() { super(); workers.push(this); }
  },
}));

const { createNodeEngine } = await import('../../companion/nodeEngine');

beforeEach(() => { vi.useFakeTimers(); workers.length = 0; });
afterEach(() => { vi.useRealTimers(); });

describe('the engine readiness deadline', () => {
  it('rejects overlapping compiles without orphaning the original request', async () => {
    const opening = createNodeEngine();
    workers[0].emit('message', { cmd: 'ready' });
    const engine = await opening;
    const first = engine.compileLaTeX();
    await expect(engine.compileLaTeX()).rejects.toThrow('compile already in flight');
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1);
    workers[0].emit('message', { pdf: [37, 80, 68, 70], log: '' });
    expect((await first).pdf).toEqual(new Uint8Array([37, 80, 68, 70]));
    const next = engine.compileLaTeX();
    workers[0].emit('message', { pdf: [37, 80, 68, 70], log: '' });
    await expect(next).resolves.toMatchObject({ status: 0 });
    await engine.dispose();
  });

  it('settles a failed compile even when its diagnostic log is empty', async () => {
    const opening = createNodeEngine();
    workers[0].emit('message', { cmd: 'ready' });
    const engine = await opening;
    let result: unknown;
    const pending = engine.compileLaTeX().then(value => { result = value; });
    workers[0].emit('message', { status: 1, log: '' });
    await Promise.resolve();
    expect(result).toMatchObject({ status: 1, log: '' });
    await pending;
    await engine.dispose();
  });

  it('rejects pending and later compiles after the worker exits', async () => {
    const opening = createNodeEngine();
    workers[0].emit('message', { cmd: 'ready' });
    const engine = await opening;
    const pending = engine.compileLaTeX();
    const failed = expect(pending).rejects.toThrow(/worker exited/);
    workers[0].emit('exit', 1);
    expect(engine.isReady()).toBe(false);
    await failed;
    await expect(engine.compileLaTeX()).rejects.toThrow(/disposed/);
  });

  it('is cleared once the worker reports ready', async () => {
    const engine = createNodeEngine();
    workers[0].emit('message', { cmd: 'ready' });
    await engine;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('terminates a worker that never reports ready', async () => {
    const engine = createNodeEngine();
    const failure = expect(engine).rejects.toThrow(/did not become ready/);
    await vi.advanceTimersByTimeAsync(60_000);
    await failure;
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });
});
