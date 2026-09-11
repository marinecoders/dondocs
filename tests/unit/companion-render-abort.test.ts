/**
 * `renderPdf` honours its abort signal in both orders: a signal that fires
 * while the compile is in flight, and one that fired while the engine was
 * still starting, before any listener could be attached. Either way the
 * engine is disposed and the render settles; a wedged compile cannot keep a
 * worker alive after the caller has stopped waiting.
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(async () => {}),
  engineReady: () => Promise.resolve(),
  compiling: false,
}));

vi.mock('../../companion/nodeEngine', () => ({
  createNodeEngine: async () => { await mocks.engineReady(); return { dispose: mocks.dispose }; },
  loadAssets: async () => ({}),
}));
vi.mock('@/services/latex/renderDocument', () => ({
  prepareEngine: () => {},
  // A compile that never finishes on its own.
  compileDocument: () => { mocks.compiling = true; return new Promise<never>(() => {}); },
  LatexCompileError: class extends Error {},
}));
vi.mock('@/services/latex/generator', () => ({ generateAllLatexFiles: () => ({ texFiles: {} }) }));

const { renderPdf } = await import('../../companion/render');
const input = { docType: 'naval_letter', subject: 'ABORT' };

beforeEach(() => { mocks.dispose.mockClear(); mocks.compiling = false; mocks.engineReady = () => Promise.resolve(); });

describe('renderPdf under abort', () => {
  it('disposes the engine when the signal fires mid-compile', async () => {
    const abort = new AbortController();
    const render = renderPdf(input, {}, { signal: abort.signal });
    await vi.waitFor(() => expect(mocks.compiling).toBe(true));
    expect(mocks.dispose).not.toHaveBeenCalled();
    abort.abort();
    await vi.waitFor(() => expect(mocks.dispose).toHaveBeenCalledTimes(1));
    void render.catch(() => {});
  });

  it('disposes the engine when the signal fired while the engine was starting', async () => {
    let ready!: () => void;
    mocks.engineReady = () => new Promise<void>((resolve) => { ready = resolve; });
    const abort = new AbortController();
    const render = renderPdf(input, {}, { signal: abort.signal });
    abort.abort();
    ready();
    await expect(render).rejects.toThrow(/abort/);
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
  });
});
