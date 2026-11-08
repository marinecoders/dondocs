import type { ReleaseAsset, ReleaseManifest } from './releases';

export const assetKey = (asset: ReleaseAsset) => `/__dd_asset/${asset.sha256}`;
type AssetCache = Pick<Cache, 'match' | 'put' | 'delete'>;
export const isWordAsset = (asset: Pick<ReleaseAsset, 'url'>) => /\/pandoc\.wasm(?:\.part\d+|\.manifest\.json)?$/.test(asset.url);

export async function hasCachedWord(manifests: ReleaseManifest[], cache: Pick<Cache, 'match'>): Promise<boolean> {
  for (const manifest of manifests) for (const asset of manifest.assets) {
    if (isWordAsset(asset) && await cache.match(assetKey(asset))) return true;
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

/** Cache the shell and PDF runtime; retain already-used Word resources without downloading an unused engine. */
export async function stageAssets(manifest: ReleaseManifest, cache: AssetCache, fetcher: typeof fetch = fetch, requireWord = false): Promise<string[]> {
  const required: string[] = [], added: string[] = [];
  try {
    for (const asset of manifest.assets) {
      if (asset.group === 'form') continue;
      const cached = await cache.match(assetKey(asset));
      if (isWordAsset(asset) && !cached && !requireWord) continue;
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
