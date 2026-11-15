import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const entry = z.object({
  docxFile: z.literal('naval-deep-browser.docx').optional(),
  pipeline: z.enum(['native-pandoc', 'browser-wasm']),
  name: z.enum(['naval-deep', 'naval-long-references', 'business-figure', 'joint-senior']),
  docxSha256: sha256,
  nativePdfSha256: sha256,
  wordPdfSha256: sha256.optional(),
  markers: z.array(z.string()),
}).strict();
const manifestSchema = z.array(entry).length(4).refine(entries => new Set(entries.map(item => item.name)).size === 4, 'The fixture inventory is incomplete.');
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const argument = process.argv[2];
if (!argument) throw new Error('Provide the directory containing the retained Word layout sources and prints.');
const browserNaval = process.argv[3] === '--browser-naval';
if (process.argv[3] && !browserNaval) throw new Error('The optional mode is --browser-naval.');
const directory = resolve(argument);
const manifestPath = join(directory, 'manifest.json');
const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const stamped = [];
for (const item of manifest) {
  if (item.docxFile && (item.name !== 'naval-deep' || item.pipeline !== 'browser-wasm')) throw new Error('Unexpected browser source binding.');
  const source = await readFile(join(directory, item.docxFile ?? `${item.name}.docx`));
  const native = await readFile(join(directory, `${item.name}-native.pdf`));
  if (digest(source) !== item.docxSha256 || digest(native) !== item.nativePdfSha256) {
    throw new Error(`${item.name}: retained source bytes do not match the generated manifest. Regenerate and print a fresh set.`);
  }
  const path = join(directory, `${item.name}-word.pdf`);
  const bytes = await readFile(path);
  if (bytes.length > 64 * 1024 * 1024) throw new Error(`${item.name}: the Word render exceeds the 64 MB qualification limit.`);
  const metadata = spawnSync('pdfinfo', [path], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (metadata.status !== 0 || !/Creator:\s+Word\b/.test(metadata.stdout)) {
    throw new Error(`${item.name}: retain the actual Microsoft Word print output before stamping.`);
  }
  if (browserNaval && item.name === 'naval-deep') {
    const browser = z.object({ pipeline: z.literal('browser-wasm'), docxSha256: sha256, project: z.string().min(1) }).parse(JSON.parse(await readFile(join(directory, 'browser-source.json'), 'utf8')));
    const browserBytes = await readFile(join(directory, 'naval-deep-browser.docx'));
    if (digest(browserBytes) !== browser.docxSha256) throw new Error('The browser Word download does not match its captured receipt.');
    stamped.push({ ...item, pipeline: 'browser-wasm' as const, docxFile: 'naval-deep-browser.docx' as const, docxSha256: browser.docxSha256, wordPdfSha256: digest(bytes) });
  } else {
    stamped.push({ ...item, wordPdfSha256: digest(bytes) });
  }
}
// Publish only after every exact source and Word print has been inspected.
const stagingPath = `${manifestPath}.tmp`;
await writeFile(stagingPath, `${JSON.stringify(stamped, null, 2)}\n`);
await rename(stagingPath, manifestPath);
process.stdout.write(`Stamped ${stamped.length} Word renders against their retained sources.\n`);
