/**
 * A `LatexEngine` backed by the vendored pdfTeX wasm running under Node.
 *
 * The browser uses `public/lib/PdfTeXEngine.js`, which cannot be imported here —
 * it reaches for `window.SWIFTLATEX_BASE_PATH`, `document.currentScript`, the DOM
 * `Worker` and `URL.createObjectURL`. Both are the same worker protocol at
 * different levels, so this implements the port directly over
 * `node:worker_threads` and the browser class needs no change at all.
 *
 * Only the transport differs. The ORDER of operations comes from
 * `renderDocument.ts`, shared with the app.
 */
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LatexEngine, CompileResult, TexlivePackage } from '@/services/latex/latexEngine';
import type { EngineAssets } from '@/services/latex/renderDocument';
import { LATEX } from '@/lib/constants';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'public', 'lib');
const ATTACHMENTS = join(HERE, '..', 'public', 'attachments');

interface WorkerReply {
  result?: string;
  cmd?: string;
  pdf?: ArrayLike<number>;
  log?: string;
  status?: number;
}

/** Evaluate one of the vendored `window.X = …` bundles and hand back what it set. */
async function loadBundle<T>(file: string, global: string): Promise<T | undefined> {
  const src = await readFile(join(LIB, file), 'utf-8');
  // The bundles assign onto `window`; under Node we point it at globalThis so
  // they have somewhere to land. Casting through `unknown` because a DOM
  // `Window` genuinely does not overlap an index signature.
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = g.window ?? g;
  new Function(src)();
  const win = g.window as Record<string, unknown>;
  return (win[global] ?? g[global]) as T | undefined;
}

interface EncodedFont { format: number; filename: string; content: string }

/**
 * Read the same asset bundles the browser loads via <script> tags. This is the
 * host-specific half — the browser gets these as globals and fetches its seals,
 * we read them off disk.
 */
export async function loadAssets(): Promise<EngineAssets> {
  const packages = await loadBundle<TexlivePackage[]>('texlive-packages.js', 'TEXLIVE_PACKAGES');
  const templates = await loadBundle<Record<string, string>>('latex-templates.js', 'LATEX_TEMPLATES');

  // Fonts ship base64 in their own arrays; the engine needs the decoded bytes or
  // every glyph width is garbage.
  const g = globalThis as unknown as Record<string, unknown>;
  const win = (g.window ?? g) as Record<string, unknown>;
  const fonts: TexlivePackage[] = [
    ...((win.TEXLIVE_FONTS as EncodedFont[]) ?? []),
    ...((win.TEXLIVE_TYPE1_FONTS as EncodedFont[]) ?? []),
    ...((win.TEXLIVE_VF_FONTS as EncodedFont[]) ?? []),
  ].map((f) => ({
    format: f.format,
    filename: f.filename,
    content: new Uint8Array(Buffer.from(f.content, 'base64')),
  }));

  // The seals the letterhead draws. The browser fetches these; here they come
  // off disk. Read from the same canonical list the app uses so a seal added
  // there is not silently missing here — which is exactly how every letter
  // ended up rendering "(add dow-seal.png)".
  const seals: Record<string, Uint8Array> = {};
  await Promise.all(LATEX.SEAL_FILES.map(async (name: string) => {
    try {
      seals[name] = new Uint8Array(await readFile(join(ATTACHMENTS, name)));
    } catch {
      // A missing seal degrades to the placeholder rather than failing the
      // render, matching how the browser treats a 404 on the same file.
    }
  }));

  return { packages: packages ?? [], fonts, templates: templates ?? {}, seals };
}

/**
 * Start the engine and resolve once it reports ready.
 *
 * Every command is fire-and-forget except the compile: the worker's queue is
 * FIFO, so a message sent after another is processed after it, which is what
 * lets `prepareEngine` be synchronous.
 */
export async function createNodeEngine(): Promise<LatexEngine & { dispose(): Promise<void> }> {
  // Capture the worker's streams instead of letting them flow to the parent's
  // stdout. The engine is chatty — "wasm streaming compile failed", "falling
  // back to ArrayBuffer instantiation", "Preloaded: 26/null" — and under the
  // MCP transport (companion/mcp.ts) the parent's stdout is the JSON-RPC
  // channel, where any of that corrupts the session. It is diagnostic output,
  // so it belongs on stderr regardless of transport.
  // Proof: tests/integration/companion-mcp.test.ts asserts stdout stays clean.
  const worker = new Worker(join(HERE, 'engineWorker.mjs'), {
    workerData: { libDir: LIB },
    stdout: true,
    stderr: true,
  });
  worker.stdout.pipe(process.stderr);
  worker.stderr.pipe(process.stderr);

  let ready = false;
  let pendingCompile: ((r: CompileResult) => void) | null = null;
  let compileFailed: ((e: Error) => void) | null = null;

  await new Promise<void>((resolve, reject) => {
    const onReady = (msg: WorkerReply) => {
      if (msg?.result === 'ok' || msg?.cmd === 'ready' || msg?.cmd === 'r') {
        ready = true;
        worker.off('message', onReady);
        resolve();
      }
    };
    worker.on('message', onReady);
    worker.once('error', reject);
    setTimeout(() => reject(new Error('engine did not become ready within 60s')), 60_000);
  });

  worker.on('message', (msg: WorkerReply) => {
    if (msg?.pdf && pendingCompile) {
      pendingCompile({ status: 0, pdf: new Uint8Array(msg.pdf), log: msg.log ?? '' });
      pendingCompile = compileFailed = null;
    } else if (msg?.log && msg?.status !== undefined && pendingCompile) {
      // A non-zero status with a log is a failed compile, not a transport error.
      pendingCompile({ status: msg.status, log: msg.log });
      pendingCompile = compileFailed = null;
    }
  });
  worker.on('error', (err) => { compileFailed?.(err); pendingCompile = compileFailed = null; });

  return {
    isReady: () => ready,
    makeMemFSFolder: (path) => { worker.postMessage({ cmd: 'mkdir', url: path }); },
    writeMemFSFile: (path, content) => { worker.postMessage({ cmd: 'writefile', url: path, src: content }); },
    preloadTexliveFile: (format, filename, content) => {
      worker.postMessage({ cmd: 'preloadtex', format, filename, content });
    },
    setEngineMainFile: (path) => { worker.postMessage({ cmd: 'setmainfile', url: path }); },
    compileLaTeX: () =>
      new Promise<CompileResult>((resolve, reject) => {
        pendingCompile = resolve;
        compileFailed = reject;
        worker.postMessage({ cmd: 'compilelatex' });
      }),
    dispose: async () => { await worker.terminate(); },
  };
}
