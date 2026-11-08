import { readFile } from 'node:fs/promises';
import { packageRelease } from './release-artifact.mjs';
if (process.env.DONDOCS_RELEASE_BUILD === '1') {
  const info = JSON.parse(await readFile('dist/.release-build.json', 'utf8'));
  const manifest = await packageRelease('dist', info);
  console.log(`Packaged release ${manifest.id}: ${manifest.assets.length} immutable resources`);
}
