import { releaseManifest, type ReleaseAsset, type ReleaseManifest } from './releases';

export const RELEASE_FILES_CACHE = 'dondocs-release-files-v1';
export const RELEASE_META_CACHE = 'dondocs-release-meta-v1';
export const releaseStateKey = (id: string) => `/__dd_release/${id}`;

export const assetKey = (asset: ReleaseAsset) => `/__dd_asset/${asset.sha256}`;
export async function getPreparedReleaseAsset(id: string, url: string, storage: Pick<CacheStorage, 'match'> = caches): Promise<Response | undefined> {
  const state = await storage.match(releaseStateKey(id), { cacheName: RELEASE_META_CACHE });
  if (!state) return undefined;
  const manifest = releaseManifest.safeParse((await state.json()).manifest);
  if (!manifest.success || manifest.data.id !== id) return undefined;
  const asset = manifest.data.assets.find(candidate => candidate.url === url);
  if (!asset) return undefined;
  const response = await storage.match(assetKey(asset), { cacheName: RELEASE_FILES_CACHE });
  if (response?.headers.get('Content-Length') === String(asset.size)) return response;
}

type AssetCache = Pick<Cache, 'match' | 'put' | 'delete'>;
export const isWordAsset = (asset: Pick<ReleaseAsset, 'url'>) => /\/lib\/pandoc\//.test(asset.url);
export const isWordEngineAsset = (asset: Pick<ReleaseAsset, 'url'>) => /\/pandoc\.wasm(?:\.part\d+|\.manifest\.json)?$/.test(asset.url);

export async function cachedWordBytes(manifest: ReleaseManifest, cache: Pick<Cache, 'match'>): Promise<number> {
  let bytes = 0;
  for (const asset of manifest.assets) {
    if (!isWordAsset(asset)) continue;
    const response = await cache.match(assetKey(asset));
    if (response?.headers.get('Content-Length') === String(asset.size)) bytes += asset.size;
  }
  return bytes;
}

export async function hasCachedWord(manifests: ReleaseManifest[], cache: Pick<Cache, 'match'>): Promise<boolean> {
  for (const manifest of manifests) for (const asset of manifest.assets) {
    if (isWordEngineAsset(asset) && await cache.match(assetKey(asset))) return true;
  }
  return false;
}

export async function cacheAsset(asset: ReleaseAsset, cache: AssetCache, fetcher: typeof fetch = fetch): Promise<Response> {
  const key = assetKey(asset), cached = await cache.match(key);
  if (cached && cached.headers.get('Content-Length') === String(asset.size)) return cached;
  const response = await fetcher(asset.url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  const actual = response.headers.get('Content-Type')?.split(';')[0].trim();
  const type = actual === 'application/javascript' ? 'text/javascript' : actual === 'image/vnd.microsoft.icon' ? 'image/x-icon' : actual;
  if (!response.ok || type === 'text/html' && asset.type !== 'text/html'
    || !['application/octet-stream', 'text/plain'].includes(asset.type) && type !== asset.type) throw new Error(`Invalid resource response: ${asset.url}`);
  const bytes = await response.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== asset.size || hash !== asset.sha256) throw new Error(`Resource integrity failed: ${asset.url}`);
  const verified = new Response(bytes, { headers: { 'Content-Type': asset.type, 'Content-Length': String(asset.size) } });
  await cache.put(key, verified.clone());
  return verified;
}

/** Cache the shell and PDF runtime; retain optional engines after use. */
export async function stageAssets(manifest: ReleaseManifest, cache: AssetCache, fetcher: typeof fetch = fetch, requireWord = false): Promise<string[]> {
  const required: string[] = [], added: string[] = [];
  try {
    for (const asset of manifest.assets) {
      if (asset.group === 'form') continue;
      const cached = await cache.match(assetKey(asset));
      // Reference text and its original PDF are optional, like unused OCR cores.
      if (/\/references\/secnav-m-5216-5\//.test(asset.url) && !cached) continue;
      if (isWordAsset(asset) && !cached && !requireWord) continue;
      // OCR requests are verified/cached by the worker fetch route on first use.
      // Do not make every release download all capability-specific OCR cores.
      if (asset.group === 'runtime' && /\/lib\/ocr\//.test(asset.url) && !cached) continue;
      if (!cached) added.push(assetKey(asset));
      await cacheAsset(asset, cache, fetcher);
      required.push(assetKey(asset));
    }
    return [...new Set(required)];
  } catch (error) {
    await Promise.all(added.map(key => cache.delete(key)));
    throw error;
  }
}
