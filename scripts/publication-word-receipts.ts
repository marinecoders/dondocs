import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { publicationWordInputPaths, verifyPublicationWordSources } from './publication-word-inputs';
import { publicationWordFixtures } from '../tests/_helpers/publicationWordQualification';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourcePath = z.string().regex(/^(?:(?:src|tests|scripts|public|companion|tex|docs)\/[a-zA-Z0-9_./-]+|package(?:-lock)?\.json|tsconfig(?:\.[a-z]+)?\.json|vitest\.config\.ts)$/).refine(path => !path.split('/').includes('..'));
const manifestSchema = z.object({
  kind: z.literal('publication-word-qualification-inputs'),
  family: z.enum(['all', 'manual', 'instruction', 'sl3', 'sl4']),
  rendererSources: z.array(z.object({ path: sourcePath, sha256: digest })).min(1),
  fixtures: z.array(z.object({ name: z.string().regex(/^[a-z0-9-]+$/), markers: z.array(z.string().min(1)).min(1), docxSha256: digest, sourceSha256: digest,
    assets: z.array(z.object({ id: z.string(), sourceFile: sourcePath, sha256: digest })).default([]) })).min(1),
});
export async function verifyPublicationWordInputs(directory: string) {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(join(resolve(directory), 'manifest.json'), 'utf8')));
  const expected = publicationWordFixtures().filter(fixture => manifest.family === 'all' || fixture.name.startsWith(`${manifest.family}-`));
  if (new Set(manifest.fixtures.map(fixture => fixture.name)).size !== manifest.fixtures.length || manifest.fixtures.length !== expected.length
    || expected.some(fixture => !manifest.fixtures.some(retained => retained.name === fixture.name))) {
    throw new Error('The selected publication family fixture inventory is incomplete or duplicated. Regenerate its inputs.');
  }
  for (const fixture of manifest.fixtures) {
    const original = expected.find(candidate => candidate.name === fixture.name)!;
    const expectedAssets = Object.entries(original.assetFiles ?? {});
    if (fixture.assets.length !== expectedAssets.length || new Set(fixture.assets.map(asset => asset.id)).size !== fixture.assets.length
      || expectedAssets.some(([id, path]) => !fixture.assets.some(asset => asset.id === id && asset.sourceFile === path))) {
      throw new Error(`${fixture.name}: the source asset inventory is incomplete or changed. Regenerate its inputs.`);
    }
    if (JSON.stringify(fixture.markers) !== JSON.stringify(original.markers)
      || fixture.sourceSha256 !== createHash('sha256').update(`${JSON.stringify(original.source, null, 2)}\n`).digest('hex')) {
      throw new Error(`${fixture.name}: the retained source or required markers changed. Regenerate its inputs.`);
    }
    for (const [suffix, expected] of [['.docx', fixture.docxSha256], ['.source.json', fixture.sourceSha256]]) {
      if (hash(await readFile(join(resolve(directory), fixture.name + suffix))) !== expected) throw new Error(`${fixture.name}${suffix}: qualification digest mismatch.`);
    }
    for (const asset of fixture.assets) {
      if (hash(await readFile(asset.sourceFile)) !== asset.sha256) throw new Error(`${fixture.name}/${asset.id}: source image digest mismatch.`);
    }
  }
  await verifyPublicationWordSources(manifest.rendererSources, await publicationWordInputPaths(expected.flatMap(fixture => Object.values(fixture.assetFiles ?? {}))));
  return manifest;
}
