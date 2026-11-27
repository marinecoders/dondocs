import { afterEach, expect, it, vi } from 'vitest';
import { connectSigningCompanion, currentSigningSession, disconnectSigningCompanion, isDisconnectPending, signingIdentities } from '@/services/forms/signingBridge';

const token = 'a'.repeat(43);
const signal = new AbortController().signal;
afterEach(async () => {
  await disconnectSigningCompanion(signal);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('obtains native consent once per tab and revokes only that session', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ token, expiresIn: 900, maxAgeSeconds: 14_400 })).mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal('fetch', fetch);
  expect(await connectSigningCompanion(signal)).toBe(token);
  expect(await connectSigningCompanion(signal)).toBe(token);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1]).toMatchObject({ body: undefined, headers: { 'X-DonDocs-Connect': '1' } });
  await disconnectSigningCompanion(signal);
  expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer ' + token);
  expect(currentSigningSession()).toBeNull();
});

it('expires after inactivity and forgets a session rejected by a restarted companion', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ token, expiresIn: 30, maxAgeSeconds: 14_400 }))
    .mockResolvedValueOnce(Response.json({ token, expiresIn: 30, maxAgeSeconds: 14_400 }))
    .mockResolvedValueOnce(Response.json({error: 'Reconnect'}, {status: 401}));
  vi.stubGlobal('fetch', fetch);
  await connectSigningCompanion(signal);
  vi.advanceTimersByTime(30_000);
  expect(currentSigningSession()).toBeNull();
  await connectSigningCompanion(signal);
  await expect(signingIdentities(token, signal)).rejects.toThrow('Reconnect');
  expect(currentSigningSession()).toBeNull();
});

it('does not create a session or inspect the document after denial', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({error: 'Connection declined'}, {status: 403}));
  vi.stubGlobal('fetch', fetch);
  await expect(connectSigningCompanion(signal)).rejects.toThrow('declined');
  expect(currentSigningSession()).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('reaches the maximum age even when an active session is refreshed', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockImplementation(async () => Response.json([]))
    .mockResolvedValueOnce(Response.json({ token, expiresIn: 30, maxAgeSeconds: 60 }));
  vi.stubGlobal('fetch', fetch);
  await connectSigningCompanion(signal);
  for (const interval of [20_000, 20_000, 19_999]) {
    vi.advanceTimersByTime(interval);
    await signingIdentities(token, signal);
  }
  vi.advanceTimersByTime(1);
  expect(currentSigningSession()).toBeNull();
  await expect(signingIdentities(token, signal)).rejects.toThrow('no longer available');
  expect(fetch).toHaveBeenCalledTimes(4);
});

it.each([200, 401])('restricts a pending grant to revocation until the companion responds with %i', async status => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ token, expiresIn: 900, maxAgeSeconds: 14_400 }))
    .mockRejectedValueOnce(new TypeError('Connection interrupted'))
    .mockResolvedValueOnce(Response.json({}, { status }));
  vi.stubGlobal('fetch', fetch);
  await connectSigningCompanion(signal);
  await expect(disconnectSigningCompanion(signal)).rejects.toThrow('Could not reach');
  expect(currentSigningSession()).toBeNull();
  expect(isDisconnectPending()).toBe(true);
  await expect(signingIdentities(token, signal)).rejects.toThrow('no longer available');
  await expect(connectSigningCompanion(signal)).rejects.toThrow('Finish disconnecting');
  expect(fetch).toHaveBeenCalledTimes(2);
  await disconnectSigningCompanion(signal);
  expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer ' + token);
  expect(isDisconnectPending()).toBe(false);
});

it('allows fresh approval after an unconfirmed disconnect reaches the grant deadline', async () => {
  vi.useFakeTimers();
  const replacement = 'b'.repeat(43);
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ token, expiresIn: 30, maxAgeSeconds: 60 }))
    .mockRejectedValueOnce(new TypeError('Disconnected from the companion'))
    .mockResolvedValueOnce(Response.json({ token: replacement, expiresIn: 30, maxAgeSeconds: 60 }))
    .mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal('fetch', fetch);
  await connectSigningCompanion(signal);
  await expect(disconnectSigningCompanion(signal)).rejects.toThrow('Could not reach');
  vi.advanceTimersByTime(59_999);
  expect(isDisconnectPending()).toBe(true);
  vi.advanceTimersByTime(1);
  expect(isDisconnectPending()).toBe(false);
  expect(await connectSigningCompanion(signal)).toBe(replacement);
});
