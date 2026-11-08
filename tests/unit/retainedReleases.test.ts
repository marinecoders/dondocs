// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packageRelease, runtimeRevision } from '../../scripts/release-artifact.mjs';
import { prepareRelease } from '../../scripts/retained-releases';

let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
it('retains old resources, rejects immutable overwrites and corruption, and fails instead of pruning over budget', async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-retention-'));
  async function candidate(id: string, body = id) {
    const dir = join(root, `${id}-${body}`);
    await mkdir(join(dir, 'lib'), { recursive: true });
    await writeFile(join(dir, 'index.html'), body);
    await writeFile(join(dir, 'lib/engine.wasm'), 'shared runtime');
    await packageRelease(dir, { id, runtime: await runtimeRevision(dir), version: 'test', createdAt: '2026-11-07T00:00:00.000Z' });
    return dir;
  }
  const old = await candidate('old'), next = await candidate('next'), out = join(root, 'out');
  await prepareRelease(next, out, old);
  expect(await readFile(join(out, 'releases/old/index.html'), 'utf8')).toBe('old');
  expect(await readFile(join(out, 'index.html'), 'utf8')).toBe('next');
  const overwrite = await candidate('old', 'changed');
  await expect(prepareRelease(overwrite, join(root, 'bad'), old)).rejects.toThrow('Immutable URL');
  await expect(prepareRelease(next, join(root, 'budget'), old, { files: 1, bytes: 1 })).rejects.toThrow('no resources were pruned');
  await writeFile(join(next, 'releases/next/index.html'), 'corrupt');
  await expect(prepareRelease(next, join(root, 'corrupt'), old)).rejects.toThrow('corrupt asset');
});

it('rejects absent, empty, or incomplete managed history before creating output', async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-history-'));
  const candidate = join(root, 'candidate'), previous = join(root, 'previous');
  await mkdir(candidate); await mkdir(previous);
  await writeFile(join(candidate, 'index.html'), 'next');
  await packageRelease(candidate, { id: 'next', runtime: await runtimeRevision(candidate), version: 'test', createdAt: '2026-11-07T00:00:00.000Z' });
  await expect(prepareRelease(candidate, join(root, 'absent'))).rejects.toThrow('Previous deployment required');
  await expect(prepareRelease(candidate, join(root, 'empty'), previous)).rejects.toThrow('manifest required');
  await expect(prepareRelease(candidate, join(root, 'empty-bootstrap'), previous, { bootstrap: true })).rejects.toThrow('complete legacy');
  await cp(candidate, previous, { recursive: true });
  await rm(join(previous, 'releases/next/release.json'));
  await expect(prepareRelease(candidate, join(root, 'missing-marker'), previous)).rejects.toThrow();
  await expect(readFile(join(root, 'missing-marker/index.html'))).rejects.toThrow();
});

it('accepts a legacy deployment only with explicit bootstrap and retains its files', async () => {
  root = await mkdtemp(join(tmpdir(), 'dondocs-legacy-history-'));
  const candidate = join(root, 'candidate'), previous = join(root, 'previous');
  await mkdir(candidate); await mkdir(previous);
  await writeFile(join(candidate, 'index.html'), 'next');
  await packageRelease(candidate, { id: 'next', runtime: await runtimeRevision(candidate), version: 'test', createdAt: '2026-11-07T00:00:00.000Z' });
  for (const [file, content] of [['index.html', 'legacy'], ['sw.js', 'legacy worker'], ['old.js', 'old bundle']]) await writeFile(join(previous, file), content);
  await expect(prepareRelease(candidate, join(root, 'not-bootstrap'), previous)).rejects.toThrow('manifest required');
  await prepareRelease(candidate, join(root, 'out'), previous, { bootstrap: true });
  expect(await readFile(join(root, 'out/old.js'), 'utf8')).toBe('old bundle');
});
