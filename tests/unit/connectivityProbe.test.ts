/**
 * The probe exists because one browser error covers two different problems.
 *
 * A refused cross-origin response and a request that never left both surface
 * as a bare TypeError with no status and no headers. Telling them apart is the
 * whole job, so that is what these pin: the second request is what separates
 * them, and a resolved-but-unreadable response still counts as reachable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyProbe, runProbe, isProbeableUrl } from '@/lib/connectivityProbe';

afterEach(() => {
  vi.restoreAllMocks();
});

const response = (status: number, type: ResponseType = 'cors') =>
  ({ status, type, headers: new Headers({ 'content-type': 'application/json' }) }) as Response;

/**
 * A request that is dropped rather than refused: it settles only when its
 * signal says so, and refuses an already-dead one the way a real fetch does.
 */
const droppedFetch = () =>
  vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal;
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason));
    });
  }) as unknown as typeof fetch;

describe('classifyProbe', () => {
  it('counts a resolved request as reachable whatever the status says', () => {
    // A 401 is the endpoint talking. Rejected credentials still prove the
    // request arrived, which is the only question being asked here.
    expect(classifyProbe({ primaryResolved: true, status: 401, responseType: 'cors' })).toBe('ok');
    expect(classifyProbe({ primaryResolved: true, status: 500, responseType: 'cors' })).toBe('ok');
  });

  it('blames the browser when the origin answered but the request did not', () => {
    expect(
      classifyProbe({ primaryResolved: false, error: 'Failed to fetch', originResolved: true })
    ).toBe('cors-blocked');
  });

  it('blames the network when nothing answered either time', () => {
    expect(
      classifyProbe({ primaryResolved: false, error: 'Failed to fetch', originResolved: false })
    ).toBe('unreachable');
  });
});

describe('runProbe', () => {
  it('does not make a second request when the first one works', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200));
    const result = await runProbe('https://example.test/v1/models', { fetchImpl });

    expect(result.verdict).toBe('ok');
    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the token so the request is preflighted like a real one would be', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200));
    await runProbe('https://example.test/v1/models', { fetchImpl, token: 'secret-value' });

    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer secret-value' },
    });
  });

  it('falls back to the origin, and reads a resolved fallback as blocked', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(0, 'opaque'));

    const result = await runProbe('https://example.test/v1/models', { fetchImpl });

    expect(result.verdict).toBe('cors-blocked');
    expect(result.error).toBe('Failed to fetch');
    // The fallback asks the origin, not the path, and asks for nothing that
    // would preflight — otherwise it could fail for its own reasons.
    expect(fetchImpl.mock.calls[1][0]).toBe('https://example.test');
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ mode: 'no-cors' });
    expect(fetchImpl.mock.calls[1][1]).not.toHaveProperty('headers');
  });

  it('reads both requests failing as nothing being there', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await runProbe('https://example.test/v1/models', { fetchImpl });

    expect(result.verdict).toBe('unreachable');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports the time it actually took, either way', async () => {
    // Asserting the elapsed time is merely non-negative would hold for any
    // number the code invented, including a hardcoded zero. Pinning the clock
    // is what makes this measure the measurement.
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_137)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_480);

    const ok = await runProbe('https://example.test/', {
      fetchImpl: vi.fn().mockResolvedValue(response(200)),
    });
    const bad = await runProbe('https://example.test/', {
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });

    expect(ok.elapsedMs).toBe(137);
    // A slow failure has to read as slow: it is how a dead path is told from
    // one that is merely refusing quickly.
    expect(bad.elapsedMs).toBe(480);
  });

  it('gives up on a request that is dropped rather than refused', async () => {
    // A silently discarded request never rejects on its own. Without a
    // deadline the probe returns nothing at all, which is worse than a wrong
    // verdict — the reader is left watching a spinner.
    const fetchImpl = droppedFetch();
    const result = await runProbe('https://example.test/v1/models', { fetchImpl, timeoutMs: 40 });

    expect(result.verdict).toBe('unreachable');
    // The browser's own wording for a timeout never says how long it waited.
    expect(result.error).toBe('No response within 0.04 s');
    // No second request once the budget is gone: it could only fail, and would
    // report as evidence what is really the same abort arriving twice.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops when the caller stops caring, without waiting out the deadline', async () => {
    const controller = new AbortController();
    const pending = runProbe('https://example.test/v1/models', {
      fetchImpl: droppedFetch(),
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    controller.abort();

    const result = await pending;
    expect(result.verdict).toBe('unreachable');
    // The caller's own abort, not the deadline — so it is not dressed up as a
    // timeout that never happened.
    expect(result.error).not.toMatch(/No response within/);
  });
});

describe('isProbeableUrl', () => {
  it('takes http and https', () => {
    expect(isProbeableUrl('https://example.test/v1')).toBe(true);
    expect(isProbeableUrl('http://example.test')).toBe(true);
  });

  it('turns away anything the probe could not send', () => {
    // file: and data: would throw inside the fetch rather than return a
    // verdict, so they are refused before the button is enabled.
    expect(isProbeableUrl('file:///etc/hosts')).toBe(false);
    expect(isProbeableUrl('not a url')).toBe(false);
    expect(isProbeableUrl('')).toBe(false);
  });
});
