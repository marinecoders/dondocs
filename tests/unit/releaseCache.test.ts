// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { assetKey, cacheAsset, stageAssets, hasCachedWord } from '@/lib/releaseCache';
import type { ReleaseAsset, ReleaseManifest } from '@/lib/releases';

function cache() {
  const data = new Map<string, Response>();
  const key = (value: RequestInfo | URL) => typeof value === 'string' ? value : value instanceof URL ? value.href : value.url;
  return { data, match: async (value: RequestInfo | URL) => data.get(key(value))?.clone(),
    put: async (value: RequestInfo | URL, response: Response) => { data.set(key(value), response.clone()); },
    delete: async (value: RequestInfo | URL) => data.delete(key(value)) };
}
function asset(url: string, body: string, group: ReleaseAsset['group'] = 'shell'): ReleaseAsset {
  return { url, sha256: createHash('sha256').update(body).digest('hex'), size: Buffer.byteLength(body), type: 'text/javascript', group };
}
const manifest = (assets: ReleaseAsset[]): ReleaseManifest => ({ schema: 1, id: 'test', version: 'test', createdAt: '2026-11-07T00:00:00.000Z', dataFormat: 1, workerProtocol: 1, entry: '/releases/test/index.html', assets });

it('deduplicates verified bytes and does not download an unused Word engine', async () => {
  const store = cache(), one = asset('/releases/one/app.js', 'same'), two = asset('/releases/two/app.js', 'same');
  const fetcher = vi.fn<typeof fetch>(async () => new Response('same', { headers: { 'Content-Type': 'text/javascript' } }));
  await cacheAsset(one, store, fetcher); await cacheAsset(two, store, fetcher);
  const keys = await stageAssets(manifest([two, asset('/runtimes/test/lib/pandoc/pandoc.wasm.part0', 'unused', 'runtime')]), store, fetcher);
  expect(fetcher).toHaveBeenCalledOnce(); expect(keys).toEqual([assetKey(one)]);
});

it('removes partial staging after a failed fetch while preserving a working release', async () => {
  const store = cache(), old = asset('/releases/old/app.js', 'old'), next = asset('/releases/new/app.js', 'new');
  await cacheAsset(old, store, async () => new Response('old', { headers: { 'Content-Type': 'text/javascript' } }));
  const fetcher = vi.fn<typeof fetch>(async url => String(url).endsWith('missing.js') ? new Response('', { status: 503 }) : new Response('new', { headers: { 'Content-Type': 'text/javascript' } }));
  await expect(stageAssets(manifest([next, asset('/releases/new/missing.js', 'missing')]), store, fetcher)).rejects.toThrow('Invalid resource');
  expect(await store.match(assetKey(old))).toBeDefined(); expect(await store.match(assetKey(next))).toBeUndefined();
});

it('stages a changed Word engine when an earlier release already provided it offline', async () => {
  const store = cache(), old = asset('/runtimes/old/lib/pandoc/pandoc.wasm.part0', 'old', 'runtime');
  const next = asset('/runtimes/new/lib/pandoc/pandoc.wasm.part0', 'new', 'runtime');
  await cacheAsset(old, store, async () => new Response('old', { headers: { 'Content-Type': 'text/javascript' } }));
  const used = await hasCachedWord([manifest([old])], store);
  expect(used).toBe(true);
  const keys = await stageAssets(manifest([next]), store, async () => new Response('new', { headers: { 'Content-Type': 'text/javascript' } }), used);
  expect(keys).toContain(assetKey(next));
  expect(await store.match(assetKey(next))).toBeDefined();
});

it('rejects corrupt bytes and HTML fallbacks before caching them', async () => {
  const store = cache(), file = asset('/releases/new/app.js', 'expected');
  await expect(cacheAsset(file, store, async () => new Response('wrong', { headers: { 'Content-Type': 'text/javascript' } }))).rejects.toThrow('integrity');
  await expect(cacheAsset(file, store, async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }))).rejects.toThrow('Invalid resource');
  expect(store.data.size).toBe(0);
});
