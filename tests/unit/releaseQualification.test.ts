// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkQualification } from '../../scripts/release-qualification';
import { legacyWorkerUrls, captureLegacyRelease } from '../../scripts/capture-legacy-release';
import releaseHost from '../../scripts/serve-release';

it('serves root HTML without redirecting immutable entry URLs or losing query parameters', async () => {
  const fetch = vi.fn(async (_request: Request) => new Response('shell'));
  const env = { ASSETS: { fetch } };
  await releaseHost.fetch(new Request('https://example.invalid/?appRelease=first'), env);
  expect(fetch.mock.calls[0]?.[0]?.url).toBe('https://example.invalid/index.html?appRelease=first');
  await releaseHost.fetch(new Request('https://example.invalid/releases/first/index.html'), env);
  expect(fetch.mock.calls[1]?.[0]?.url).toBe('https://example.invalid/releases/first/index.html');
});

it('requires actual device/host attestations for the current source and destination', () => {
  const digest = 'a'.repeat(64);
  const record = { schema: 1, sourceDigest: digest,
    iphone: { device: 'Test device', os: 'Test OS', browser: 'Test browser', build: 'test-build', checkedAt: '2026-11-07T00:00:00.000Z', installedResume: true, acceptedUpdate: true, offlineReopen: true, attachmentBytes: true, backupRestore: true },
    production: { url: 'https://example.invalid', canonicalWorkerVerified: true, competingPublishersDisabled: true } };
  expect(checkQualification(record, digest, 'https://example.invalid').sourceDigest).toBe(digest);
  expect(() => checkQualification({ schema: 1, iphone: null }, digest)).toThrow();
  expect(() => checkQualification(record, 'b'.repeat(64))).toThrow('different source');
  expect(() => checkQualification(record, digest, 'https://other.invalid')).toThrow('different production');
  expect(() => checkQualification({ ...record, iphone: { ...record.iphone, offlineReopen: false } }, digest)).toThrow();
});

it('extracts static legacy precache and worker support URLs without executing worker code', () => {
  const worker = 'define(["./workbox-ab12"],function(e){ importScripts("sw-cleanup.js");e.precacheAndRoute([{url:"assets/old.js",revision:"old"},{url:"lib/engine.js?v=1",revision:null}],{}); });';
  expect(legacyWorkerUrls(worker)).toEqual(expect.arrayContaining(['./workbox-ab12.js', 'sw-cleanup.js', 'assets/old.js', 'lib/engine.js?v=1']));
  expect(() => legacyWorkerUrls('throw new Error("must never run")')).toThrow('Unsupported legacy worker');
});

it('captures the deployed legacy hashes and runtime bytes, excluding host control pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dondocs-legacy-capture-'));
  const publicRoot = join(root, 'public'), output = join(root, 'previous');
  await mkdir(join(publicRoot, 'lib'), { recursive: true });
  await writeFile(join(publicRoot, 'lib/engine.js'), 'source runtime');
  await writeFile(join(publicRoot, '404.html'), 'host control page');
  const resources: Record<string, string> = { '/': '<html>deployed shell</html>', '/sw.js': 'e.precacheAndRoute([{url:"assets/deployed-hash.js",revision:null}]);', '/assets/deployed-hash.js': 'deployed bundle', '/lib/engine.js': 'deployed runtime' };
  const fetcher = vi.fn(async (url: URL) => new Response(resources[url.pathname], { status: resources[url.pathname] ? 200 : 404, headers: { 'Content-Type': url.pathname === '/' ? 'text/html' : 'text/javascript' } }));
  vi.stubGlobal('fetch', fetcher);
  try {
    await captureLegacyRelease('https://example.invalid', output, publicRoot);
    expect(await readFile(join(output, 'assets/deployed-hash.js'), 'utf8')).toBe('deployed bundle');
    expect(await readFile(join(output, 'lib/engine.js'), 'utf8')).toBe('deployed runtime');
    expect(fetcher.mock.calls.some(([url]) => url.pathname === '/404.html')).toBe(false);
  } finally { vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
});
