/**
 * Copy the pdf.js worker that matches the installed react-pdf into
 * public/lib/pdf.worker.min.mjs.
 *
 * The app pins pdf.js's workerSrc to that vendored file
 * (src/components/pdf/pdfConfig.ts). pdf.js hard-fails when the worker version
 * differs from the API version, so any react-pdf/pdfjs-dist upgrade MUST
 * re-vendor the worker — CI runs this script and asserts a clean diff
 * (`pdf worker in sync` job), the same guard pattern as build-templates.mjs
 * for the LaTeX bundle.
 *
 * Resolution deliberately goes THROUGH react-pdf: pdfjs-dist is nested under
 * react-pdf's own node_modules (other packages pin different majors), and the
 * nested copy is the one whose API the app actually runs.
 *
 * Usage: npm run sync:pdf-worker
 */
import { createRequire } from 'node:module';
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const requireFromRepo = createRequire(join(repoRoot, 'package.json'));
const reactPdfPkgPath = requireFromRepo.resolve('react-pdf/package.json');
const requireFromReactPdf = createRequire(reactPdfPkgPath);
const pdfjsPkgPath = requireFromReactPdf.resolve('pdfjs-dist/package.json');

const pdfjsDir = dirname(pdfjsPkgPath);
const { version } = JSON.parse(readFileSync(pdfjsPkgPath, 'utf8'));
const workerSrc = join(pdfjsDir, 'build', 'pdf.worker.min.mjs');
const workerDest = join(repoRoot, 'public', 'lib', 'pdf.worker.min.mjs');

copyFileSync(workerSrc, workerDest);
console.log(`pdf.worker.min.mjs vendored from pdfjs-dist@${version} (via react-pdf)`);
