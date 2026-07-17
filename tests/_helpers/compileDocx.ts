/**
 * End-to-end DOCX compile harness via pandoc.
 *
 * The DOCX export path is independent of the SwiftLaTeX one:
 * `flat-generator.ts` emits a single self-contained .tex file using
 * only the standard LaTeX subset that pandoc understands, and pandoc
 * converts that to DOCX. This module exercises that pipeline end-to-end.
 *
 * Why a separate harness from compileLatex.ts: the LaTeX path uses
 * `tex/main.tex` + per-doc-type templates with custom macros; the
 * DOCX path emits inline tabular constructs and standard packages
 * only. Different inputs, different failure modes (pandoc rejecting
 * unknown commands vs. xelatex undefined-macro errors), so different
 * test files.
 *
 * Fidelity: the invocation mirrors the production options object in
 * `pandoc-converter.ts` (`from: latex+raw_tex`, `filters: dondocs.lua`,
 * `reference-doc`, layout metadata). Anything less silently changes what
 * the flat-generator's custom constructs mean — without `+raw_tex` the
 * reader drops `\enclref{1}` instead of handing it to the Lua filter, so
 * "See \enclref{1}." extracts as "See ." here while users get
 * "See Enclosure (1).", and every differential assertion runs against a
 * pipeline that never ships. The JSZip post-pass (`postProcessDocx`:
 * cell padding, fonts, classification header) is NOT mirrored — it
 * rewrites styling XML, not the text content these tests extract.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { LAYOUT, layoutToMetadata } from '@/services/docx/layout-config';
import type { TestStore } from './compileLatex';

// Same resolution trick as compileLatex.ts: absolute paths anchored to this
// file's location so the harness works from any cwd (vitest, cartesian run).
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// The exact support files production ships into pandoc WASM's file map.
const PANDOC_SUPPORT_DIR = join(REPO_ROOT, 'public', 'lib', 'pandoc');
// Production maps the seal PNG into pandoc's working dir by filename; the
// resource path lets `\includegraphics{dow-seal.png}` resolve to the same
// bytes here without copying a seal into every fixture's workDir.
const SEAL_DIR = join(REPO_ROOT, 'public', 'attachments');

export interface DocxCompileResult {
  ok: boolean;
  exitCode: number | null;
  /** stdout + stderr from pandoc, full log. */
  log: string;
  docxBytes?: Uint8Array;
  workDir: string;
}

function runPandoc(
  cwd: string,
  inputFile: string,
  outputFile: string,
  metadata: Record<string, string>
): Promise<{
  exitCode: number | null;
  log: string;
}> {
  return new Promise((resolve) => {
    let log = '';
    const proc = spawn(
      'pandoc',
      [
        // CLI spelling of the production options object (pandoc-converter.ts
        // feeds pandoc WASM a defaults-file-shaped `options`; a `.lua` entry
        // in a defaults `filters` list runs as a Lua filter, which is what
        // `--lua-filter` does here).
        '--from=latex+raw_tex',
        '--to=docx',
        `--lua-filter=${join(PANDOC_SUPPORT_DIR, 'dondocs.lua')}`,
        `--reference-doc=${join(PANDOC_SUPPORT_DIR, 'reference.docx')}`,
        ...Object.entries(metadata).map(([key, value]) => `--metadata=${key}:${value}`),
        `--resource-path=.${delimiter}${SEAL_DIR}`,
        '--output', outputFile,
        inputFile,
      ],
      { cwd, timeout: 30_000 }
    );

    proc.stdout.on('data', (chunk) => { log += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { log += chunk.toString(); });
    proc.on('error', (err) => {
      log += `\n[harness] spawn error: ${err.message}`;
      resolve({ exitCode: -1, log });
    });
    proc.on('close', (code) => {
      resolve({ exitCode: code, log });
    });
  });
}

export async function compileDocxFixture(store: TestStore): Promise<DocxCompileResult> {
  const tex = generateFlatLatex(store);

  const workDir = await mkdtemp(join(tmpdir(), 'dondocs-docx-'));
  const inputFile = join(workDir, 'flat.tex');
  const outputFile = join(workDir, 'out.docx');

  await writeFile(inputFile, tex);

  // Same metadata production builds: layout proportions for the Lua filter's
  // table-width pass, plus the font size it scales \baselineskip spacing by.
  const metadata: Record<string, string> = {
    ...layoutToMetadata(LAYOUT),
    'font-size-pt': String(parseInt(store.formData.fontSize || '12pt', 10) || 12),
  };

  const { exitCode, log } = await runPandoc(workDir, 'flat.tex', 'out.docx', metadata);
  const ok = exitCode === 0;

  let docxBytes: Uint8Array | undefined;
  if (ok) {
    try {
      docxBytes = await readFile(outputFile);
    } catch {
      return { ok: false, exitCode, log, workDir };
    }
  }

  return { ok, exitCode, log, docxBytes, workDir };
}

export function formatDocxFailure(name: string, result: DocxCompileResult): string {
  // Pandoc errors are usually 1-3 lines; just show the whole log.
  const tail = result.log.split('\n').slice(-30).join('\n');
  return [
    `Fixture: ${name}`,
    `pandoc exit: ${result.exitCode}`,
    `Work dir:    ${result.workDir}`,
    '',
    `Log (last 30 lines):`,
    tail,
  ].join('\n');
}
