// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { assetKey } from '@/lib/releaseCache';
import type { ReleaseAsset } from '@/lib/releases';

const origin = 'https://example.test';
const stores = new Map<string, Map<string, Response>>();
const listeners = new Map<string, ((event: unknown) => void)[]>();
const key = (input: RequestInfo | URL) => new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin).href;
function store(name: string) {
  let data = stores.get(name);
  if (!data) { data = new Map(); stores.set(name, data); }
  const entries = data;
  return {
    match: async (input: RequestInfo | URL) => entries.get(key(input))?.clone(),
    put: async (input: RequestInfo | URL, response: Response) => { entries.set(key(input), response.clone()); },
    keys: async () => [...entries.keys()].map(url => new Request(url)),
  };
}
async function request(id: string) {
  let response: Promise<Response> | undefined;
  const event = {
    request: new Request(`${origin}/classification.config.json?deployment-policy=runtime&appRelease=${id}`),
    respondWith: (result: Promise<Response>) => { response = result; },
  };
  for (const listener of listeners.get('fetch') ?? []) listener(event);
  expect(response, 'the release worker must handle runtime policy requests').toBeDefined();
  return response!;
}
async function stage(id: string, body: string) {
  const asset: ReleaseAsset = { url: `/releases/${id}/classification.config.json`, sha256: createHash('sha256').update(body).digest('hex'), size: Buffer.byteLength(body), type: 'application/json', group: 'shell' };
  const entry = { ...asset, url: `/releases/${id}/index.html`, type: 'text/html' };
  const manifest = { schema: 1, id, version: 'test', createdAt: '2026-11-07T00:00:00.000Z', dataFormat: 1, workerProtocol: 1, entry: entry.url, assets: [entry, asset] };
  await store('dondocs-release-meta-v1').put(`/__dd_release/${id}`, Response.json({ manifest, required: [assetKey(asset)], preparedAt: 1 }));
  await store('dondocs-release-files-v1').put(assetKey(asset), new Response(body, { headers: { 'Content-Type': 'application/json', 'Content-Length': String(asset.size) } }));
}
beforeEach(async () => {
  stores.clear(); listeners.clear(); vi.resetModules();
  vi.stubGlobal('self', { location: { origin }, addEventListener: (type: string, listener: (event: unknown) => void) => { listeners.set(type, [...listeners.get(type) ?? [], listener]); } });
  vi.stubGlobal('caches', { open: async (name: string) => store(name) });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  await import('@/sw');
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('uses the requesting release policy offline rather than another staged release', async () => {
  await stage('first', 'null'); await stage('second', '{"maxLevel":"secret"}');
  expect(await (await request('first')).text()).toBe('null');
  expect(await (await request('second')).json()).toEqual({ maxLevel: 'secret' });
});
it('retains a runtime update for offline use ahead of the bundled default', async () => {
  await stage('first', 'null');
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ maxLevel: 'cui' }));
  expect(await (await request('first')).json()).toEqual({ maxLevel: 'cui' });
  expect(await (await request('first')).json()).toEqual({ maxLevel: 'cui' });
});
it('preserves explicit absence and server errors instead of falling back to a bundled override', async () => {
  await stage('first', '{"maxLevel":"secret"}');
  vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response('', { status: 503 }));
  expect((await request('first')).status).toBe(404);
  expect((await request('first')).status).toBe(503);
  expect((await request('first')).status).toBe(404);
});
