import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { renderPublicationDocx } from '../src/services/docx/publication';
import { publicationWordFixtures } from '../tests/_helpers/publicationWordQualification';
import { publicationWordInputPaths, publicationWordSourceDigests } from './publication-word-inputs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: vite-node --config vitest.config.ts scripts/generate-publication-word.mts OUTPUT_DIRECTORY');
const output = resolve(directory);
await mkdir(output, { recursive: true });
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const seal = new Uint8Array(await readFile('public/attachments/usmc-seal.png'));
const sourceFiles = await publicationWordInputPaths();
const rendererSources = await publicationWordSourceDigests(sourceFiles);
const receipts = [];
for (const fixture of publicationWordFixtures()) {
  const blob = await renderPublicationDocx(fixture.source, { readAsset: () => { throw new Error('Unexpected figure resource.'); }, loadSeal: async () => seal }, new AbortController().signal, new Date('2026-10-30T12:00:00Z'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(join(output, `${fixture.name}.docx`), bytes);
  const sourceBytes = JSON.stringify(fixture.source, null, 2) + '\n';
  const sourcePath = join(output, `${fixture.name}.source.json`);
  await writeFile(sourcePath, sourceBytes);
  const sourceSha256 = sha256(await readFile(sourcePath));
  if (sourceSha256 !== sha256(sourceBytes)) throw new Error('The retained publication source changed while writing its receipt.');
  receipts.push({ name: fixture.name, docxSha256: sha256(bytes), sourceSha256, bytes: bytes.byteLength, markers: fixture.markers });
}
await writeFile(join(output, 'manifest.json'), JSON.stringify({ kind: 'publication-word-qualification-inputs', ref: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), rendererSources, dirtyDiffSha256: sha256(execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8' })), pipeline: 'production-native-ooxml', generatedAt: new Date().toISOString(), fixtures: receipts }, null, 2));
console.log(JSON.stringify({ directory: output, fixtures: receipts }, null, 2));
