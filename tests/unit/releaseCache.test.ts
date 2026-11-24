// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { assetKey, cacheAsset, stageAssets, hasCachedWord, cachedWordBytes, getPreparedReleaseAsset, RELEASE_FILES_CACHE, RELEASE_META_CACHE, releaseStateKey } from '@/lib/releaseCache';
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

it('deduplicates verified bytes and keeps all unused Word files off the PDF-only path', async () => {
  const store = cache(), one = asset('/releases/one/app.js', 'same'), two = asset('/releases/two/app.js', 'same');
  const wordAssets = ['pandoc.js', 'wasi-shim.js', 'reference.docx', 'dondocs.lua', 'pandoc.wasm.manifest.json', 'pandoc.wasm.part0']
    .map(file => asset(`/runtimes/test/lib/pandoc/${file}`, file, 'runtime'));
  const fetcher = vi.fn<typeof fetch>(async () => new Response('same', { headers: { 'Content-Type': 'text/javascript' } }));
  await cacheAsset(one, store, fetcher);
  await cacheAsset(two, store, fetcher);
  const keys = await stageAssets(manifest([two, ...wordAssets]), store, fetcher);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(keys).toEqual([assetKey(one)]);
});

it('counts only matching prepared Word resources after a cache eviction', async () => {
  const store = cache();
  const loader = asset('/runtimes/test/lib/pandoc/pandoc.js', 'loader', 'runtime');
  const part = asset('/runtimes/test/lib/pandoc/pandoc.wasm.part0', 'some bytes', 'runtime');
  const pdf = asset('/runtimes/test/lib/swiftlatexpdftex.js', 'renderer', 'runtime');
  const release = manifest([loader, part, pdf]);
  for (const resource of [loader, part, pdf]) {
    await store.put(assetKey(resource), new Response('', { headers: { 'Content-Length': String(resource.size) } }));
  }
  expect(await cachedWordBytes(release, store)).toBe(loader.size + part.size);
  await store.delete(assetKey(part));
  expect(await cachedWordBytes(release, store)).toBe(loader.size);
  expect(await hasCachedWord([release], store)).toBe(false);
  await store.put(assetKey(part), new Response('', { headers: { 'Content-Length': '1' } }));
  expect(await cachedWordBytes(release, store)).toBe(loader.size);
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

it('keeps unused OCR runtime assets on demand during immutable release preparation', async () => {
  const store = cache(), app = asset('/releases/new/app.js', 'app');
  const worker = asset('/runtimes/new/lib/ocr/7.0.0/worker.min.js', 'worker', 'runtime');
  const core = asset('/runtimes/new/lib/ocr/7.0.0/tesseract-core-lstm.wasm', 'core', 'runtime');
  const model = asset('/runtimes/new/lib/ocr/7.0.0/eng.traineddata.gz', 'model', 'runtime');
  const fetcher = vi.fn<typeof fetch>(async url => new Response(String(url) === app.url ? 'app' : String(url) === worker.url ? 'worker' : String(url) === core.url ? 'core' : 'model', { headers: { 'Content-Type': 'text/javascript' } }));
  const keys = await stageAssets(manifest([app, worker, core, model]), store, fetcher);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(app.url, expect.any(Object));
  expect(keys).toEqual([assetKey(app)]);
  await cacheAsset(worker, store, fetcher);
  const subsequent = await stageAssets(manifest([app, worker, core, model]), store, fetcher);
  expect(subsequent).toContain(assetKey(worker));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('reads the exact prepared asset by its content key without the service worker intercepting requests', async () => {
  const files = cache(), meta = cache();
  const path = '/releases/test/assets/dictionary.txt';
  const wordList = asset(path, 'dictionary');
  const entry = asset('/releases/test/index.html', 'entry');
  const storage = {
    match: (request: RequestInfo | URL, options?: MultiCacheQueryOptions) => {
      expect([RELEASE_META_CACHE, RELEASE_FILES_CACHE]).toContain(options?.cacheName);
      return (options?.cacheName === RELEASE_META_CACHE ? meta : files).match(request);
    },
  };
  await expect(getPreparedReleaseAsset('test', path, storage)).resolves.toBeUndefined();
  await meta.put(releaseStateKey('test'), Response.json({ manifest: manifest([entry, wordList]) }));
  await files.put(assetKey(wordList), new Response('dictionary', { headers: { 'Content-Length': String(wordList.size) } }));
  await expect(getPreparedReleaseAsset('test', '/releases/other/assets/dictionary.txt', storage)).resolves.toBeUndefined();
  expect(await (await getPreparedReleaseAsset('test', path, storage))?.text()).toBe('dictionary');
});
