import { execFileSync } from 'node:child_process';
import { cp, rm, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { files } from './release-artifact.mjs';

await mkdir('.release-fixtures', { recursive: true });
for (const id of ['a', 'b', 'c']) {
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit', env: { ...process.env, DONDOCS_RELEASE_BUILD: '1', DONDOCS_RELEASE_ID: `qualification-${id}` } });
  const out = `.release-fixtures/${id}`;
  await rm(out, { recursive: true, force: true }); await cp('dist', out, { recursive: true });
  // Include a saved form revision so hosting checks cover its root namespace.
  const bytes = await readFile('public/templates/NAVMC11811 - Administrative Remarks/page1.pdf');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const url = `/templates/qualification/revisions/${hash}/page1.pdf`;
  await mkdir(join(out, 'templates/qualification/revisions', hash), { recursive: true });
  await writeFile(join(out, url.slice(1)), bytes);
  const manifest = JSON.parse(await readFile(join(out, 'release.json'), 'utf8'));
  manifest.assets.push({ url, sha256: hash, size: bytes.length, type: 'application/pdf', group: 'form' });
  for (const path of ['release.json', `releases/${manifest.id}/release.json`]) await writeFile(join(out, path), JSON.stringify(manifest));
}

// A coherent, hash-valid artifact whose entry module throws models a bad application release.
// Production files and working source are never modified.
const broken = '.release-fixtures/broken';
await rm(broken, { recursive: true, force: true }); await cp('.release-fixtures/b', broken, { recursive: true });
await rename(join(broken, 'releases/qualification-b'), join(broken, 'releases/broken'));
for (const file of await files(broken)) {
  if (/\.(?:js|mjs|css|html|json)$/.test(file)) await writeFile(join(broken, file), (await readFile(join(broken, file), 'utf8')).replaceAll('qualification-b', 'broken'));
}
const manifest = JSON.parse(await readFile(join(broken, 'release.json'), 'utf8'));
const html = await readFile(join(broken, 'releases/broken/index.html'), 'utf8');
const entry = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
if (!entry) throw new Error('No module entry in the qualification fixture');
const path = join(broken, decodeURIComponent(entry.slice(1)));
await writeFile(path, `throw new Error('Qualification boot failure');\n${await readFile(path, 'utf8')}`);
for (const asset of manifest.assets) {
  const bytes = await readFile(join(broken, decodeURIComponent(asset.url.slice(1))));
  asset.size = bytes.length; asset.sha256 = createHash('sha256').update(bytes).digest('hex');
}
await writeFile(join(broken, 'release.json'), JSON.stringify(manifest));
await writeFile(join(broken, 'releases/broken/release.json'), JSON.stringify(manifest));
