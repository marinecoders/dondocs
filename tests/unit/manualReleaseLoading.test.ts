// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import source from '@/data/correspondenceManualSource.json';
import { assetKey, cacheAsset, stageAssets } from '@/lib/releaseCache';
import { releaseManifest, type ReleaseAsset } from '@/lib/releases';

it('stages manual resources only after use and retains their verified bytes across releases', async () => {
  const bodies = new Map<string, Uint8Array>();
  const references: ReleaseAsset[] = [];
  for (const kind of ['text', 'pdf'] as const) {
    const path = kind === 'pdf' ? source.pdfPath : source.textPath;
    const url = `/releases/first/${path}`;
    bodies.set(url, new Uint8Array(await readFile(`public/${path}`)));
    references.push({ url, size: kind === 'pdf' ? source.pdfBytes : source.textBytes,
      sha256: kind === 'pdf' ? source.sourceSha256 : source.textSha256,
      type: kind === 'pdf' ? 'application/pdf' : 'application/json', group: 'shell' });
  }
  const shell: ReleaseAsset = { url: '/releases/first/index.html', size: 5, sha256: createHash('sha256').update('shell').digest('hex'), type: 'text/html', group: 'shell' };
  bodies.set(shell.url, new TextEncoder().encode('shell'));
  const assets = new Map<string, Response>();
  const cache = { match: async (key: string) => assets.get(key)?.clone(),
    put: async (key: string, response: Response) => { assets.set(key, response.clone()); },
    delete: async (key: string) => assets.delete(key) };
  const fetcher = vi.fn<typeof fetch>(async input => {
    const file = [shell, ...references].find(asset => asset.url === String(input));
    if (!file) throw new Error('Unexpected resource');
    return new Response(new Uint8Array(bodies.get(file.url)!), { headers: { 'Content-Type': file.type } });
  });
  const manifest = releaseManifest.parse({ schema: 1, id: 'first', version: 'test', createdAt: '2026-11-19T00:00:00.000Z',
    dataFormat: 1, workerProtocol: 1, entry: '/releases/first/index.html', assets: [shell, ...references] });
  expect(await stageAssets(manifest, cache, fetcher)).toEqual([assetKey(shell)]);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(shell.url, expect.any(Object));

  // The worker fetch route uses cacheAsset only when the reader requests text.
  await cacheAsset(references[0], cache, fetcher);
  const next = releaseManifest.parse({ ...manifest, id: 'second', entry: '/releases/second/index.html',
    assets: [shell, ...references].map(asset => ({ ...asset, url: asset.url.replace('/first/', '/second/') })) });
  expect(await stageAssets(next, cache, fetcher)).toEqual([assetKey(shell), assetKey(references[0])]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await cache.match(assetKey(references[1]))).toBeUndefined();
});
