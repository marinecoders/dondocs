import { test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { releaseManifest } from '../../src/lib/releases';
import { checkOfflineSpelling } from './offlineSpelling';
import { startUpgradeServer } from './upgradeServer';

test.use({ serviceWorkers: 'allow' });

test('uses the packaged spelling dictionary on its first offline use', async ({ page, context }) => {
  const build = process.env.RELEASE_BUILD_A;
  if (!build) throw new Error('Set RELEASE_BUILD_A to a packaged release artifact.');
  const root = resolve(build);
  const manifest = releaseManifest.parse(JSON.parse(await readFile(resolve(root, 'release.json'), 'utf8')));
  const server = await startUpgradeServer({ root: () => root });
  try {
    await checkOfflineSpelling(page, context, server.origin, manifest.id);
  } finally {
    await server.close();
  }
});
