import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { publicationWordInputPaths, verifyPublicationWordSources } from './publication-word-inputs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: vite-node scripts/verify-publication-word.mts OUTPUT_DIRECTORY');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourcePath = z.string().regex(/^(?:(?:src|tests|scripts|public|companion|tex|docs)\/[a-zA-Z0-9_./-]+|package(?:-lock)?\.json|tsconfig(?:\.[a-z]+)?\.json|vitest\.config\.ts)$/).refine(path => !path.split('/').includes('..'));
const manifest = z.object({
  kind: z.literal('publication-word-qualification-inputs'),
  rendererSources: z.array(z.object({ path: sourcePath, sha256: digest })).min(1),
  fixtures: z.array(z.object({ name: z.string().regex(/^[a-z0-9-]+$/), docxSha256: digest, sourceSha256: digest,
    assets: z.array(z.object({ id: z.string(), sourceFile: sourcePath, sha256: digest })).default([]) })).min(1),
}).parse(JSON.parse(await readFile(join(resolve(directory), 'manifest.json'), 'utf8')));
for (const fixture of manifest.fixtures) {
  for (const [suffix, expected] of [['.docx', fixture.docxSha256], ['.source.json', fixture.sourceSha256]]) {
    if (hash(await readFile(join(resolve(directory), fixture.name + suffix))) !== expected) throw new Error(`${fixture.name}${suffix}: qualification digest mismatch.`);
  }
  for (const asset of fixture.assets) {
    if (hash(await readFile(asset.sourceFile)) !== asset.sha256) throw new Error(`${fixture.name}/${asset.id}: source image digest mismatch.`);
  }
}
await verifyPublicationWordSources(manifest.rendererSources, await publicationWordInputPaths(manifest.fixtures.flatMap(fixture => fixture.assets.map(asset => asset.sourceFile))));
console.log(`Verified ${manifest.fixtures.length} DOCX/source receipts and ${manifest.rendererSources.length} renderer source digests.`);
