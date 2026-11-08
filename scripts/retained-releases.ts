import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { files } from './release-artifact.mjs';
import { releaseManifest, type ReleaseManifest } from '../src/lib/releases';

function resourcePath(root: string, url: string): string {
  const file = resolve(root, `.${decodeURIComponent(url)}`);
  if (!file.startsWith(resolve(root) + sep)) throw new Error('Asset escapes the release directory');
  return file;
}

export async function verifyRelease(root: string, input: unknown): Promise<ReleaseManifest> {
  const manifest = releaseManifest.parse(input);
  for (const asset of manifest.assets) {
    const bytes = await readFile(resourcePath(root, asset.url));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== asset.size || digest !== asset.sha256) throw new Error(`Incomplete or corrupt asset: ${asset.url}`);
  }
  return manifest;
}

async function verifyPrevious(root: string, bootstrap: boolean) {
  const names = await files(root);
  if (!names.includes('release.json')) {
    if (!bootstrap) throw new Error('Previous managed deployment manifest required');
    if (!names.includes('index.html') || !names.includes('sw.js') || names.some(name => /^(?:releases|runtimes)\//.test(name))
      || (await readFile(resolve(root, 'index.html'), 'utf8')).includes('name="dondocs-release"')) throw new Error('A complete legacy deployment is required for bootstrap');
    return;
  }
  const current = await verifyRelease(root, JSON.parse(await readFile(resolve(root, 'release.json'), 'utf8')));
  const entryManifest = resolve(root, `releases/${current.id}/release.json`);
  const stored = releaseManifest.parse(JSON.parse(await readFile(entryManifest, 'utf8')));
  if (JSON.stringify(stored) !== JSON.stringify(current)) throw new Error('Previous root and immutable manifests differ');
  if (!(await readFile(resolve(root, 'index.html'))).equals(await readFile(resourcePath(root, current.entry)))) throw new Error('Previous HTML does not match its release');
  for (const name of names.filter(name => /^releases\/[^/]+\/release.json$/.test(name))) {
    await verifyRelease(root, JSON.parse(await readFile(resolve(root, name), 'utf8')));
  }
}

/** Build a fresh deployment directory. Never prune retained application or form resources. */
export async function prepareRelease(candidate: string, output: string, previous?: string, options: { files?: number; bytes?: number; bootstrap?: boolean } = {}) {
  const budget = { files: options.files ?? 20000, bytes: options.bytes ?? 2 * 1024 ** 3 };
  const current = await verifyRelease(candidate, JSON.parse(await readFile(resolve(candidate, 'release.json'), 'utf8')));
  if (previous) await verifyPrevious(previous, options.bootstrap === true);
  else if (!options.bootstrap) throw new Error('Previous deployment required unless bootstrap is explicit');
  await mkdir(output); // Existing output is an error: stale control files must not survive a failed preparation.
  if (previous) await cp(previous, output, { recursive: true });
  for (const file of await files(candidate)) {
    const from = resolve(candidate, file), to = resolve(output, file);
    if (/^(?:releases\/|runtimes\/|templates\/.*\/revisions\/)/.test(file)) {
      let existing: Buffer | undefined;
      try { existing = await readFile(to); } catch { /* New immutable URL. */ }
      if (existing && !existing.equals(await readFile(from))) throw new Error(`Immutable URL already has different content: ${file}`);
    }
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, await readFile(from));
  }
  let bytes = 0;
  const deployed = await files(output);
  for (const file of deployed) {
    const size = (await stat(resolve(output, file))).size;
    if (size > 25 * 1024 ** 2) throw new Error(`Asset exceeds hosting limit: ${file}`);
    bytes += size;
  }
  if (deployed.length > budget.files || bytes > budget.bytes) throw new Error('Release retention exceeds the deployment budget; no resources were pruned');
  await verifyRelease(output, current);
  if (!(await readFile(resolve(output, 'index.html'))).equals(await readFile(resourcePath(output, current.entry)))) throw new Error('Current HTML does not match the release entry');
  return { id: current.id, files: deployed.length, bytes };
}
