/**
 * The probe exists because one browser error covers two different problems.
 *
 * A refused cross-origin response and a request that never left both surface
 * as a bare TypeError with no status and no headers. Telling them apart is the
 * whole job, so that is what these pin: the second request is what separates
 * them, and a resolved-but-unreadable response still counts as reachable.
 */
import { describe, it, expect, vi } from 'vitest';
import { classifyProbe, runProbe, isProbeableUrl } from '@/lib/connectivityProbe';

const response = (status: number, type: ResponseType = 'cors') =>
  ({ status, type, headers: new Headers({ 'content-type': 'application/json' }) }) as Response;

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
    const result = await runProbe('https://example.test/v1/models', undefined, fetchImpl);

    expect(result.verdict).toBe('ok');
    expect(result.status).toBe(200);
    expect(result.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the token so the request is preflighted like a real one would be', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200));
    await runProbe('https://example.test/v1/models', 'secret-value', fetchImpl);

    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer secret-value' },
    });
  });

  it('falls back to the origin, and reads a resolved fallback as blocked', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(0, 'opaque'));

    const result = await runProbe('https://example.test/v1/models', undefined, fetchImpl);

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
    const result = await runProbe('https://example.test/v1/models', undefined, fetchImpl);

    expect(result.verdict).toBe('unreachable');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports a time either way, so a slow failure is visible as slow', async () => {
    const ok = await runProbe('https://example.test/', undefined, vi.fn().mockResolvedValue(response(200)));
    const bad = await runProbe(
      'https://example.test/',
      undefined,
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    );

    expect(ok.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(bad.elapsedMs).toBeGreaterThanOrEqual(0);
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
