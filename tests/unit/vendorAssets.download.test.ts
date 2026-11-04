import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWasmWithRetry } from '../../scripts/vendor-assets.mjs';

// Match the production size floor. Mock body reads to share this buffer rather
// than copying 50MiB for each response; no network or filesystem work runs.
const validWasm = new Uint8Array(50 * 1024 * 1024);
validWasm.set([0x00, 0x61, 0x73, 0x6d]);
const response = (bytes: Uint8Array) => ({
  ok: true, body: {}, arrayBuffer: async () => bytes.buffer,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('complete WASM download retries', () => {
  it('retries an HTTP 200 truncated body before accepting the complete asset', async () => {
    const truncated = new Uint8Array(7_421_976); // Size observed in PR #371's failed build.
    truncated.set(validWasm.subarray(0, 4));
    const fetch = vi.fn().mockResolvedValueOnce(response(truncated)).mockResolvedValueOnce(response(validWasm));
    vi.stubGlobal('fetch', fetch);
    const result = fetchWasmWithRetry('https://example.test/pandoc.wasm');
    await vi.runAllTimersAsync();
    expect((await result).equals(Buffer.from(validWasm.buffer))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].signal).not.toBe(fetch.mock.calls[1][1].signal);
  });

  it('retries when the body stream fails after successful HTTP headers', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, body: {}, arrayBuffer: async () => { throw new Error('stream interrupted'); } })
      .mockResolvedValueOnce(response(validWasm));
    vi.stubGlobal('fetch', fetch);
    const result = fetchWasmWithRetry('https://example.test/pandoc.wasm');
    await vi.runAllTimersAsync();
    expect((await result).byteLength).toBe(validWasm.byteLength);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries an invalid WASM header even when the response has the required size', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(new Uint8Array(validWasm.byteLength)))
      .mockResolvedValueOnce(response(validWasm));
    vi.stubGlobal('fetch', fetch);
    const result = fetchWasmWithRetry('https://example.test/pandoc.wasm');
    await vi.runAllTimersAsync();
    expect((await result).subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('still retries HTTP errors and network failures', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(response(validWasm));
    vi.stubGlobal('fetch', fetch);
    const result = fetchWasmWithRetry('https://example.test/pandoc.wasm');
    await vi.runAllTimersAsync();
    expect((await result).byteLength).toBe(validWasm.byteLength);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('fails after the retry limit rather than accepting corrupt bytes', async () => {
    const fetch = vi.fn().mockResolvedValue(response(new Uint8Array(4)));
    vi.stubGlobal('fetch', fetch);
    const failure = expect(fetchWasmWithRetry('https://example.test/pandoc.wasm'))
      .rejects.toThrow('download failed after 3 attempts — got 4 bytes');
    await vi.runAllTimersAsync();
    await failure;
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
