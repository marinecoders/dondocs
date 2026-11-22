// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publicationWordFixtures } from '../_helpers/publicationWordQualification';
import { verifyPublicationWordInputs } from '../../scripts/publication-word-receipts';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function manifest(family = 'manual') {
  return { kind: 'publication-word-qualification-inputs', family, rendererSources: [{ path: 'package.json', sha256: hash('unused') }],
    fixtures: publicationWordFixtures().filter(fixture => fixture.name.startsWith(`${family}-`)).map(fixture => ({ name: fixture.name,
      markers: fixture.markers, sourceSha256: hash(`${JSON.stringify(fixture.source, null, 2)}\n`), docxSha256: hash('unused'),
      assets: Object.entries(fixture.assetFiles ?? {}).map(([id, sourceFile]) => ({ id, sourceFile, sha256: hash('unused') })) })) };
}
async function verify(value: ReturnType<typeof manifest>) {
  const path = await mkdtemp(join(tmpdir(), 'publication-word-receipt-')); directories.push(path);
  await writeFile(join(path, 'manifest.json'), JSON.stringify(value));
  return verifyPublicationWordInputs(path);
}

describe('publication family receipt scope', () => {
  it('rejects a missing or duplicated fixture before accepting a family', async () => {
    const missing = manifest(); missing.fixtures.pop();
    await expect(verify(missing)).rejects.toThrow('inventory is incomplete or duplicated');
    const duplicate = manifest(); duplicate.fixtures[1] = duplicate.fixtures[0];
    await expect(verify(duplicate)).rejects.toThrow('inventory is incomplete or duplicated');
  });

  it('rejects weakened required markers and a changed fixture source', async () => {
    const weakened = manifest(); weakened.fixtures[0].markers = ['A. SAMPLE'];
    await expect(verify(weakened)).rejects.toThrow('retained source or required markers changed');
    const source = manifest(); source.fixtures[0].sourceSha256 = hash('changed source');
    await expect(verify(source)).rejects.toThrow('retained source or required markers changed');
  });

  it.each(['missing', 'extra', 'duplicate', 'path'] as const)('rejects a %s image inventory independently of the retained module graph', async change => {
    const value = manifest('sl4');
    const original = value.fixtures[0].assets[0];
    if (change === 'missing') value.fixtures[0].assets = [];
    if (change === 'extra') value.fixtures[0].assets.push({ ...original, id: 'unexpected' });
    if (change === 'duplicate') value.fixtures[0].assets.push(original);
    if (change === 'path') value.fixtures[0].assets[0] = { ...original, sourceFile: 'public/attachments/usmc-seal.png' };
    await expect(verify(value)).rejects.toThrow('source asset inventory is incomplete or changed');
  });
});
