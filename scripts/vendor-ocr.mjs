import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const destination = join(root, 'public/lib/ocr/7.0.0');
for (const dependency of ['tesseract.js', 'tesseract.js-core']) {
  const metadata = JSON.parse(await readFile(join(root, 'node_modules', dependency, 'package.json'), 'utf8'));
  if (metadata.version !== '7.0.0') throw new Error(`OCR worker protocol requires ${dependency} 7.0.0; review the adapter before changing it.`);
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const worker = await readFile(join(root, 'node_modules/tesseract.js/dist/worker.min.js'), 'utf8');
// All actual paths are supplied by our adapter. Remove upstream CDN defaults so
// an omitted path fails locally instead of contacting a public service.
await writeFile(join(destination, 'worker.min.js'), worker
  .replaceAll('https://cdn.jsdelivr.net/npm/', '/missing-local-ocr-assets/')
  .replace(/\/\/# sourceMappingURL=.*$/m, ''));
for (const file of await readdir(join(root, 'node_modules/tesseract.js-core'))) {
  // The adapter always requests LSTM-only. Retain non-SIMD, SIMD and relaxed
  // SIMD variants, without shipping unused legacy recognition cores.
  if (/^tesseract-core(?:-(?:simd|relaxedsimd))?-lstm\.wasm(?:\.js)?$/.test(file)) {
    await copyFile(join(root, 'node_modules/tesseract.js-core', file), join(destination, file));
  }
}
await copyFile(join(root, 'node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'), join(destination, 'eng.traineddata.gz'));
await copyFile(join(root, 'node_modules/tesseract.js/LICENSE.md'), join(destination, 'TESSERACT-LICENSE.txt'));
await copyFile(join(root, 'node_modules/tesseract.js-core/LICENSE'), join(destination, 'CORE-LICENSE.txt'));
console.log('[vendor-ocr] Staged local OCR worker, cores and English language data.');
