/// <reference lib="webworker" />
import { releaseManifest, releaseId, manifestUrl, type ReleaseManifest, type ReleaseAsset } from './lib/releases';
import { assetKey, cacheAsset, stageAssets, isWordAsset, hasCachedWord } from './lib/releaseCache';
declare const self: ServiceWorkerGlobalScope;

const FILES = 'dondocs-release-files-v1', META = 'dondocs-release-meta-v1';
const stateKey = (id: string) => `/__dd_release/${id}`;
const CURRENT = '/__dd_current';
const WORD_USED = '/__dd_word_used';
const POLICY_CACHE = 'deployment-policy-v1';
const POLICY_KEY = '/classification.config.json?deployment-policy=runtime';
interface ReadyRelease { manifest: ReleaseManifest; required: string[]; preparedAt: number }
const assets = new Map<string, ReleaseAsset>();
let loaded: Promise<void> | undefined;
let preparation: Promise<unknown> = Promise.resolve();

async function readyReleases(): Promise<ReadyRelease[]> {
  const cache = await caches.open(META), result: ReadyRelease[] = [];
  for (const key of await cache.keys()) {
    if (!new URL(key.url).pathname.startsWith('/__dd_release/')) continue;
    const response = await cache.match(key);
    try {
      const state = await response!.json() as ReadyRelease;
      state.manifest = releaseManifest.parse(state.manifest);
      if (Array.isArray(state.required)) result.push(state);
    } catch { /* An invalid marker never advertises a ready release. */ }
  }
  return result;
}
function remember(manifest: ReleaseManifest) { for (const asset of manifest.assets) assets.set(asset.url, asset); }
async function loadAssets() {
  loaded ??= readyReleases().then(states => { for (const state of states) remember(state.manifest); });
  await loaded;
}
async function isReady(id: string): Promise<boolean> {
  const meta = await caches.open(META), fileCache = await caches.open(FILES);
  const response = await meta.match(stateKey(releaseId.parse(id)));
  if (!response) return false;
  const state = await response.json() as ReadyRelease;
  releaseManifest.parse(state.manifest);
  for (const key of state.required) if (!await fileCache.match(key)) return false;
  return true;
}
async function readManifest(id?: string): Promise<ReleaseManifest> {
  if (id) {
    const stored = await (await caches.open(META)).match(stateKey(releaseId.parse(id)));
    if (stored) return releaseManifest.parse((await stored.json() as ReadyRelease).manifest);
  }
  const response = await fetch(id ? manifestUrl(id) : '/release.json', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Release manifest unavailable');
  const manifest = releaseManifest.parse(await response.json());
  if (id && manifest.id !== id) throw new Error('Release identity mismatch');
  return manifest;
}
function prepare(manifest: ReleaseManifest): Promise<void> {
  const next = preparation.then(async () => {
    const fileCache = await caches.open(FILES), meta = await caches.open(META);
    let requireWord = !!await meta.match(WORD_USED) || await hasCachedWord((await readyReleases()).map(state => state.manifest), fileCache);
    // Keep the capability across the initial transition from Workbox's URL-keyed cache.
    if (!requireWord) for (const name of await caches.keys()) {
      if (name.startsWith('pandoc-wasm-') && (await (await caches.open(name)).keys()).some(key => isWordAsset({ url: new URL(key.url).pathname }))) { requireWord = true; break; }
    }
    if (requireWord) await meta.put(WORD_USED, new Response('1'));
    const required = await stageAssets(manifest, fileCache, fetch, requireWord);
    await (await caches.open(META)).put(stateKey(manifest.id), Response.json({ manifest, required, preparedAt: Date.now() } satisfies ReadyRelease));
    remember(manifest);
  });
  preparation = next.catch(() => {});
  return next;
}

async function clientReleases(): Promise<string[] | undefined> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const answers = await Promise.all(clients.map(client => new Promise<string[] | undefined>(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(undefined); }, 1500);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      const data = event.data;
      resolve(data?.protocol === 1 && Array.isArray(data.releases) && data.releases.every((id: unknown) => releaseId.safeParse(id).success) ? data.releases : undefined);
    };
    client.postMessage({ type: 'DD_CLIENT_PROTOCOL' }, [channel.port2]);
  })));
  return answers.some(answer => answer === undefined) ? undefined : answers.flat() as string[];
}
async function collectUnused() {
  const live = await clientReleases();
  if (!live) return; // Frozen or legacy clients prevent cleanup.
  const states = (await readyReleases()).sort((a, b) => b.preparedAt - a.preparedAt);
  const keep = new Set([...live, ...states.slice(0, 2).map(state => state.manifest.id)]);
  const referenced = new Set(states.filter(state => keep.has(state.manifest.id)).flatMap(state => state.manifest.assets.map(assetKey)));
  const meta = await caches.open(META), fileCache = await caches.open(FILES);
  for (const state of states) if (!keep.has(state.manifest.id)) await meta.delete(stateKey(state.manifest.id));
  for (const key of await fileCache.keys()) if (!referenced.has(new URL(key.url).pathname)) await fileCache.delete(key);
  assets.clear(); for (const state of states) if (keep.has(state.manifest.id)) remember(state.manifest);
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') return; // Legacy acceptance must not force a takeover.
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil((async () => {
    try {
      const { type, id } = event.data;
      if (type === 'ACTIVATE_WORKER') {
        if (await clientReleases() === undefined) throw new Error('Legacy or inactive tabs still use the previous worker');
        await self.skipWaiting();
      } else if (type === 'PREPARE_RELEASE') await prepare(await readManifest(releaseId.parse(id)));
      else if (type === 'CHECK_RELEASE') {
        const manifest = await readManifest(); await prepare(manifest);
        await (await caches.open(META)).put(CURRENT, Response.json({ id: manifest.id }));
        port.postMessage({ protocol: 1, manifest }); return;
      } else if (type !== 'IS_RELEASE_READY') throw new Error('Unsupported release request');
      port.postMessage({ protocol: 1, ready: id ? await isReady(id) : true });
    } catch (error) { port.postMessage({ protocol: 1, error: error instanceof Error ? error.message : String(error) }); }
  })());
});

self.addEventListener('activate', event => { event.waitUntil((async () => {
  await loadAssets();
  if (await clientReleases() !== undefined) await self.clients.claim();
})()); });
// Claim only identified clients; never reload pages or delete legacy Workbox caches.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (url.pathname === '/classification.config.json' && url.searchParams.get('deployment-policy') === 'runtime') {
    event.respondWith((async () => {
      const cache = await caches.open(POLICY_CACHE);
      try {
        const response = await fetch(event.request, { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
        if (response.status === 200 || response.status === 404) {
          try { await cache.put(POLICY_KEY, response.clone()); } catch { /* Storage failure must not hide the current network policy. */ }
        }
        return response;
      } catch {
        const cached = await cache.match(POLICY_KEY);
        if (cached) return cached;
        const id = releaseId.parse(url.searchParams.get('appRelease'));
        await loadAssets();
        const asset = assets.get(`/releases/${id}/classification.config.json`);
        if (!asset) throw new Error('Deployment policy is unavailable offline.');
        return cacheAsset(asset, await caches.open(FILES));
      }
    })());
    return;
  }
  if (event.request.mode === 'navigate' && (['/', '/index.html'].includes(url.pathname) || /^\/releases\/[^/]+\/index.html$/.test(url.pathname))) {
    event.respondWith((async () => {
      try {
        const id = url.pathname.match(/^\/releases\/([^/]+)\/index.html$/)?.[1] || url.searchParams.get('appRelease');
        let manifest: ReleaseManifest;
        if (id) { manifest = await readManifest(releaseId.parse(id)); await prepare(manifest); }
        else {
          try {
            const response = await fetch(event.request, { signal: AbortSignal.timeout(5000) });
            if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) throw new Error('Application HTML unavailable');
            return response;
          } catch {
            const current = await (await caches.open(META)).match(CURRENT);
            if (!current) return fetch(event.request);
            manifest = await readManifest((await current.json() as { id: string }).id);
          }
        }
        if (!await isReady(manifest.id)) throw new Error('Release is incomplete offline');
        const entry = manifest.assets.find(asset => asset.url === manifest.entry)!;
        return await cacheAsset(entry, await caches.open(FILES));
      } catch {
        return new Response('<!doctype html><title>Update unavailable</title><p>This release could not be opened. Reconnect and reload. Your saved documents have not been changed.</p>', { status: 503, headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }
  if (/^\/(?:releases|runtimes|templates)\//.test(url.pathname)) event.respondWith((async () => {
    await loadAssets();
    const asset = assets.get(url.pathname);
    if (isWordAsset({ url: url.pathname })) await (await caches.open(META)).put(WORD_USED, new Response('1'));
    return asset ? cacheAsset(asset, await caches.open(FILES)) : fetch(event.request);
  })());
});

// Collection is explicit and conservative; it never touches document/form databases.
self.addEventListener('message', event => {
  if (event.data?.type === 'COLLECT_RELEASES') {
    const collection = preparation.then(collectUnused);
    preparation = collection.catch(() => {}); event.waitUntil(collection);
  }
});
