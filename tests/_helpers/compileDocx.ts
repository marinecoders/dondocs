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
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import type { TestStore } from './compileLatex';

export interface DocxCompileResult {
  ok: boolean;
  exitCode: number | null;
  /** stdout + stderr from pandoc, full log. */
  log: string;
  docxBytes?: Uint8Array;
  workDir: string;
}

function runPandoc(cwd: string, inputFile: string, outputFile: string): Promise<{
  exitCode: number | null;
  log: string;
}> {
  return new Promise((resolve) => {
    let log = '';
    const proc = spawn(
      'pandoc',
      [
        '--from=latex',
        '--to=docx',
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

  const { exitCode, log } = await runPandoc(workDir, 'flat.tex', 'out.docx');
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
