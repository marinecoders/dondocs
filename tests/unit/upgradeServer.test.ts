// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUpgradeServer } from '../browser/upgradeServer';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const run of cleanup.splice(0).reverse()) await run(); });

it('revalidates control files, retains only immutable paths, and exposes deployment faults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-upgrade-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const old = join(dir, 'old'), current = join(dir, 'current');
  for (const root of [old, current]) await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(old, 'assets/old.js'), 'old bundle');
  await writeFile(join(old, 'mutable.json'), 'old data');
  await writeFile(join(current, 'index.html'), '<!doctype html>new');
  const server = await startUpgradeServer({ root: () => current });
  cleanup.push(server.close);
  server.retain(old);
  const html = await fetch(server.origin);
  expect(html.headers.get('cache-control')).toBe('no-cache, must-revalidate');
  expect((await fetch(server.origin, { headers: { 'If-None-Match': html.headers.get('etag')! } })).status).toBe(304);
  const asset = await fetch(`${server.origin}/assets/old.js`);
  expect(await asset.text()).toBe('old bundle');
  expect(asset.headers.get('cache-control')).toContain('immutable');
  expect((await fetch(`${server.origin}/mutable.json`)).status).toBe(404);
  server.faults.set('/assets/old.js', { status: 503, body: 'incomplete upload' });
  expect((await fetch(`${server.origin}/assets/old.js`)).status).toBe(503);
  server.faults.set('/assets/old.js', { contentType: 'text/html', body: '<!doctype html>bad fallback' });
  expect((await fetch(`${server.origin}/assets/old.js`)).headers.get('content-type')).toBe('text/html');
});
