// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { packageRelease, runtimeRevision } from '../../scripts/release-artifact.mjs';
import { releaseManifest } from '@/lib/releases';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it('pins complete resources, shares unchanged runtimes, and preserves saved form revision URLs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dondocs-release-')); roots.push(root);
  for (const [file, body] of Object.entries({
    'index.html': '<script src="/releases/first/assets/app.js"></script>',
    'assets/app.js': 'import("./lazy.js")', 'assets/lazy.js': 'export default 1',
    'lib/pandoc/dondocs.lua': '-- support', 'lib/engine.wasm': 'wasm',
    'templates/sample/revisions/abc/page1.pdf': 'pdf',
    'templates/Legacy Form/page1.pdf': 'legacy pdf',
  })) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), body); }
  const runtime = await runtimeRevision(root);
  await writeFile(join(root, 'index.html'), 'new shell');
  expect(await runtimeRevision(root)).toBe(runtime);
  const manifest = releaseManifest.parse(await packageRelease(root, { id: 'first', runtime, version: 'test', createdAt: '2026-11-07T00:00:00.000Z' }));
  for (const asset of manifest.assets) {
    const bytes = await readFile(join(root, decodeURIComponent(asset.url.slice(1))));
    expect(bytes.length).toBe(asset.size);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
  }
  expect(manifest.assets.find(asset => asset.url.endsWith('/lazy.js'))?.group).toBe('shell');
  expect(manifest.assets.find(asset => asset.url.endsWith('/dondocs.lua'))?.url).toBe(`/runtimes/${runtime}/lib/pandoc/dondocs.lua`);
  expect(manifest.assets.find(asset => asset.group === 'form')?.url).toBe('/templates/sample/revisions/abc/page1.pdf');
  expect(await readFile(join(root, 'index.html'), 'utf8')).toBe('new shell');
  expect(releaseManifest.safeParse({ ...manifest, assets: [...manifest.assets, manifest.assets[0]] }).success).toBe(false);
  expect(releaseManifest.safeParse({ ...manifest, entry: '/index.html' }).success).toBe(false);
  expect(releaseManifest.safeParse({ ...manifest, assets: [{ ...manifest.assets[0], url: '//other.invalid/steal' }] }).success).toBe(false);
});
