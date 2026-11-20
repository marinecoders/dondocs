import { readFile } from 'node:fs/promises';
import { packageRelease } from './release-artifact.mjs';
if (process.env.DONDOCS_RELEASE_BUILD === '1') {
  let info;
  try {
    info = JSON.parse(await readFile('dist/.release-build.json', 'utf8'));
  } catch (err) {
    console.error(`[package-release] failed to load dist/.release-build.json: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const manifest = await packageRelease('dist', info);
  console.log(`Packaged release ${manifest.id}: ${manifest.assets.length} immutable resources`);
}
