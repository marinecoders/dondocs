import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { releaseManifest } from '../src/lib/releases';
const [origin, directory = 'release-site'] = process.argv.slice(2).filter(arg => arg !== '--identity-only');
if (!origin) throw new Error('Production origin required');
const expected = releaseManifest.parse(JSON.parse(await readFile(`${directory}/release.json`, 'utf8')));
const response = await fetch(new URL('/release.json', origin), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
const actual = releaseManifest.parse(await response.json());
if (actual.id !== expected.id) throw new Error('The production domain is not serving the prepared release');
if (!Buffer.from(JSON.stringify(actual)).equals(Buffer.from(JSON.stringify(expected)))) throw new Error('The production manifest differs from the deployment archive');
if (process.argv.includes('--identity-only')) {
  console.log(`Production matches archived release ${expected.id}`);
  process.exit(0);
}
for (const path of ['/', '/sw.js', '/release.json']) {
  const result = await fetch(new URL(path, origin), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!result.ok || !Buffer.from(await result.arrayBuffer()).equals(await readFile(`${directory}/${file}`))) throw new Error(`Published control file differs: ${path}`);
  if (!/no-cache|no-store|max-age=0/.test(result.headers.get('Cache-Control') || '')) throw new Error(`Control file does not revalidate: ${path}`);
}
for (const asset of expected.assets) {
  const result = await fetch(new URL(asset.url, origin), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!result.ok) throw new Error(`Published asset missing: ${asset.url}`);
  const hash = createHash('sha256').update(Buffer.from(await result.arrayBuffer())).digest('hex');
  // Content hashes are public integrity metadata, not secrets.
  // eslint-disable-next-line security/detect-possible-timing-attacks
  if (hash !== asset.sha256) throw new Error(`Published asset mismatch: ${asset.url}`);
  const type = result.headers.get('Content-Type')?.split(';')[0].replace('application/javascript', 'text/javascript');
  if (/^(?:text\/html|text\/javascript|text\/css|application\/wasm|application\/json)$/.test(asset.type) && type !== asset.type) throw new Error(`Published MIME type differs: ${asset.url}`);
  if (!result.headers.get('Cache-Control')?.includes('immutable')) throw new Error(`Immutable asset has mutable cache policy: ${asset.url}`);
}
for (const path of [`/releases/${expected.id}/does-not-exist.js`, `/templates/qualification/revisions/${'0'.repeat(64)}/does-not-exist.pdf`]) {
  const missing = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(15000) });
  if (missing.status !== 404) throw new Error(`Production substitutes HTML for a missing resource: ${path}`);
}
console.log(`Verified published release ${expected.id}`);
