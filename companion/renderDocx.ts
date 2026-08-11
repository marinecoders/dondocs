/**
 * DOCX through the same generator the app uses.
 *
 * `generateFlatLatex` produces a flattened source that pandoc converts, with the
 * project's own lua filter and reference document.
 *
 * KNOWN LIMITATION — the converter is not the same one the app runs. The app
 * uses a vendored pandoc 3.9 WASM build; this spawns whatever pandoc is on
 * PATH. Output can therefore differ from a browser export in ways this code
 * cannot see.
 *
 * That is a deliberate, pre-existing tradeoff rather than a new one:
 * `tests/_helpers/compileDocx.ts`, the repo's production-faithful DOCX harness,
 * spawns system pandoc for the same reason — `pandoc-converter.ts` is 1569
 * lines of browser-bound code (window.location, fetch, Blob, dynamic URL
 * import) and cannot be imported here. Closing the gap means porting it behind
 * a port the way `LatexEngine` was, which is its own project.
 *
 * What this file owes the caller in the meantime is honesty: report the version
 * actually used, and fail clearly when pandoc is absent rather than at the far
 * end of a confusing stack.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFlatLatex } from '@/services/latex/flat-generator';
import { toStore, type CompanionDefaults, type LetterInput } from './letterInput';
import { RENDER_TIMEOUT_MS } from './limits';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'lib');

/** The pandoc the app vendors, for comparison against whatever is on PATH. */
export const VENDORED_PANDOC = '3.9';

let cachedVersion: string | null | undefined;

/** The system pandoc version, or null when pandoc is not installed. */
export async function systemPandocVersion(): Promise<string | null> {
  if (cachedVersion !== undefined) { return cachedVersion; }
  cachedVersion = await new Promise<string | null>((resolve) => {
    const p = spawn('pandoc', ['--version']);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(null));
    p.on('close', (code) => resolve(code === 0 ? (out.match(/pandoc\s+([0-9.]+)/)?.[1] ?? 'unknown') : null));
  });
  return cachedVersion;
}

/**
 * Pandoc rides the same budget as the render as a whole (see limits.ts), so the
 * two cannot drift apart and leave a wedged pandoc outliving the request that
 * started it.
 */
const PANDOC_TIMEOUT_MS = RENDER_TIMEOUT_MS;

export async function renderDocx(input: LetterInput, defaults: CompanionDefaults = {}): Promise<Uint8Array> {
  const tex = generateFlatLatex(toStore(input, defaults) as never);
  const dir = await mkdtemp(join(tmpdir(), 'dondocs-companion-'));

  try {
    await writeFile(join(dir, 'in.tex'), tex, 'utf-8');

    await new Promise<void>((resolve, reject) => {
      const pandoc = spawn('pandoc', [
        'in.tex', '-f', 'latex+raw_tex', '-o', 'out.docx',
        '--lua-filter', join(LIB, 'pandoc', 'dondocs.lua'),
        '--reference-doc', join(LIB, 'pandoc', 'reference.docx'),
      ], { cwd: dir });

      let stderr = '';
      let settled = false;
      const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };

      const timer = setTimeout(() => {
        pandoc.kill('SIGKILL');
        finish(() => reject(new Error(`pandoc did not finish within ${PANDOC_TIMEOUT_MS}ms and was killed`)));
      }, PANDOC_TIMEOUT_MS);

      pandoc.stderr.on('data', (d) => { stderr += d; });
      pandoc.on('error', () => finish(() => reject(new Error('pandoc is not installed or not on PATH'))));
      pandoc.on('close', (code) => finish(() => (code === 0
        ? resolve()
        : reject(new Error(`pandoc exited ${code}: ${stderr}`)))));
    });

    return new Uint8Array(await readFile(join(dir, 'out.docx')));
  } finally {
    // Every conversion used to leave its scratch directory behind. One is
    // nothing; a companion left running for a week is thousands.
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best effort */ });
  }
}
