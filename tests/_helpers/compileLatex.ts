/**
 * End-to-end LaTeX compile harness for the integration test suite.
 *
 * The unit / property / fuzz tests assert on the *string* that
 * `generateAllLatexFiles` produces. They never ask `xelatex` whether
 * that string is actually valid LaTeX. Most "compiles in dev, breaks in
 * prod" bugs hide in that gap (mismatched braces, undefined macros,
 * package-not-loaded, math-mode-from-text crashes).
 *
 * This module spawns a real `xelatex` process per fixture, captures
 * the log, and reports either success (with PDF bytes) or a parsed
 * error trace. The intent is that `tests/integration/latex-compile.test.ts`
 * runs a fixture matrix through this and asserts every combination
 * compiles.
 *
 * Engine choice: xelatex (not pdflatex). SwiftLaTeX in production is
 * a XeTeX fork, so xelatex is the closest local engine. A bug that
 * compiles in xelatex but not in SwiftLaTeX would still be a SwiftLaTeX
 * quirk worth knowing about — but the inverse (compiles in SwiftLaTeX,
 * fails in xelatex) is uncommon and would still be a bug worth fixing.
 *
 * Templates: read directly from `tex/main.tex` and `tex/templates/*.tex`
 * — these are the canonical source. The `public/lib/latex-templates.js`
 * bundle is built from them by `build-templates.sh`. Testing against
 * source means a stale bundle doesn't mask a real bug; a separate test
 * could verify the bundle is in sync if that becomes a concern.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAllLatexFiles } from '@/services/latex/generator';
import type { Reference, Enclosure, Paragraph, CopyTo, Distribution, DocumentData } from '@/types/document';

// `import.meta.dirname` isn't always available; resolve the repo root
// relative to this file's location: tests/_helpers/compileLatex.ts → repo root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

export interface TestStore {
  docType: string;
  formData: Partial<DocumentData>;
  references: Reference[];
  enclosures: Enclosure[];
  paragraphs: Paragraph[];
  copyTos: CopyTo[];
  distributions: Distribution[];
}

export interface CompileResult {
  ok: boolean;
  exitCode: number | null;
  /** Parsed `! ...` LaTeX errors with 3 lines of context each. */
  errors: string[];
  /** Last 60 lines of the xelatex log, for debugging when no `!` line is found. */
  logTail: string;
  /** PDF bytes on success. */
  pdfBytes?: Uint8Array;
  /** Temp directory containing all .tex files + log + (on success) PDF.
   *  Kept for CI artifact upload on failure. */
  workDir: string;
}

/**
 * Cache the `tex/` source files in memory across the test run. Reading
 * 20+ files from disk per fixture would dominate the wall time.
 */
let templatesCache: Record<string, string> | null = null;

async function loadTemplates(): Promise<Record<string, string>> {
  if (templatesCache) return templatesCache;
  const result: Record<string, string> = {};

  // tex/main.tex (lives at the root of tex/)
  result['tex/main.tex'] = await readFile(join(REPO_ROOT, 'tex', 'main.tex'), 'utf-8');

  // tex/templates/*.tex
  const templatesDir = join(REPO_ROOT, 'tex', 'templates');
  const entries = await readdir(templatesDir);
  for (const entry of entries) {
    if (entry.endsWith('.tex')) {
      result[`tex/templates/${entry}`] = await readFile(
        join(templatesDir, entry),
        'utf-8'
      );
    }
  }

  templatesCache = result;
  return result;
}

/**
 * Parse `xelatex`'s log for actual error markers. xelatex prints lines
 * starting with `! ` for any LaTeX error (undefined control sequence,
 * missing `}`, etc.). Capture each error plus the next 3 lines — that's
 * usually the offending input line and the file it came from.
 */
function parseLatexErrors(log: string): string[] {
  const lines = log.split('\n');
  const errors: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('! ')) {
      errors.push(lines.slice(i, i + 5).join('\n'));
    }
  }
  return errors;
}

function tail(log: string, n: number): string {
  const lines = log.split('\n');
  return lines.slice(-n).join('\n');
}

/**
 * Run `xelatex` in `cwd` on `mainFile`. Resolves with the result —
 * never rejects, even on timeout. The caller decides what counts as
 * a failure based on `exitCode`.
 */
function runXelatex(cwd: string, mainFile: string): Promise<{
  exitCode: number | null;
  log: string;
}> {
  return new Promise((resolve) => {
    let log = '';
    const proc = spawn(
      'xelatex',
      [
        '-interaction=nonstopmode',
        '-halt-on-error',
        '-output-directory', cwd,
        '-no-shell-escape',
        mainFile,
      ],
      { cwd, timeout: 45_000 }
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

/**
 * Compile a fixture with xelatex. Single-pass — we don't need
 * `\pageref{LastPage}` resolution for compile-error detection. If a
 * future test wants accurate page counts, run xelatex twice.
 */
export async function compileFixture(store: TestStore): Promise<CompileResult> {
  const { texFiles } = generateAllLatexFiles(store);
  const templates = await loadTemplates();

  const workDir = await mkdtemp(join(tmpdir(), 'dondocs-compile-'));

  // Mirror SwiftLaTeX's runtime path layout: it strips `tex/` and
  // `templates/` prefixes when writing to the virtual filesystem
  // (see useLatexEngine.ts), so `tex/templates/naval_letter.tex` is
  // accessible as just `naval_letter.tex`. The template's
  // `\input{\DocumentType}` expects exactly that — bare doc-type name
  // resolved at the root.
  for (const [path, content] of Object.entries(templates)) {
    let target = path.startsWith('tex/') ? path.slice(4) : path;
    target = target.startsWith('templates/') ? target.slice(10) : target;
    await writeFile(join(workDir, target), content);
  }

  // Write all generated runtime files at the working directory root —
  // that's where the templates' `\input{document.tex}` etc. look.
  for (const [name, content] of Object.entries(texFiles)) {
    await writeFile(join(workDir, name), content);
  }

  // SwiftLaTeX-compat shim is a runtime stub for browser-only macros;
  // on regular xelatex it's a no-op file. Provide an empty package.
  await writeFile(
    join(workDir, 'swiftlatex-compat.sty'),
    '\\ProvidesPackage{swiftlatex-compat}[2024 stub for local xelatex]\n'
  );

  // Provide a stub flags.tex if the generator produced one that
  // references a missing image. (Real flags come from public/seals/
  // which we don't ship to the test harness.) The generator emits
  // `\setSealType{...}` which the templates resolve via image lookups
  // we mock out here.
  // No-op for now; if individual fixtures need stubs, the matrix can
  // override them.

  const { exitCode, log } = await runXelatex(workDir, 'main.tex');
  const ok = exitCode === 0;
  const errors = parseLatexErrors(log);
  const logTail = tail(log, 60);

  let pdfBytes: Uint8Array | undefined;
  if (ok) {
    try {
      pdfBytes = await readFile(join(workDir, 'main.pdf'));
    } catch {
      // xelatex returned 0 but no PDF — treat as failure.
      return { ok: false, exitCode, errors, logTail, workDir };
    }
  }

  return { ok, exitCode, errors, logTail, pdfBytes, workDir };
}

/**
 * Format a CompileResult into a human-readable failure message for
 * test assertions. Includes the parsed errors + log tail + work dir
 * (so devs can `cd` in and reproduce manually).
 */
export function formatFailure(name: string, result: CompileResult): string {
  const errSection = result.errors.length
    ? `Parsed errors:\n${result.errors.join('\n--- next error ---\n')}`
    : `No "!" error markers in log. Last 60 lines:\n${result.logTail}`;
  return [
    `Fixture: ${name}`,
    `xelatex exit: ${result.exitCode}`,
    `Work dir:    ${result.workDir}`,
    '',
    errSection,
  ].join('\n');
}
