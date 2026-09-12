/**
 * Render one document and put it on disk.
 *
 * The single step both transports share. HTTP and MCP differ only in how a
 * request arrives and how a result is phrased — the sandbox check, the render
 * and the write are the same work, and duplicating them is how two front doors
 * quietly grow two different security postures.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { renderPdf } from './render';
import { renderDocx } from './renderDocx';
import type { CompanionDefaults, LetterInput } from './letterInput';
import { filenameFor, resolveOutputPath } from './outputPath';
import { RENDER_TIMEOUT_MS, RenderTimeoutError } from './limits';

/** The document rendered; putting it at `path` did not. */
export class OutputWriteError extends Error {
  constructor(path: string, cause: unknown) {
    super(`could not write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'OutputWriteError';
  }
}

export interface RenderedFile {
  format: 'pdf' | 'docx';
  /** Absolute path, always inside `root`. */
  path: string;
  /** The same file as `out` names it: relative to the root, so a second call with it replaces this one. */
  out: string;
  bytes: number;
}

/** `name.pdf`, then `name-2.pdf`, `name-3.pdf` ... */
function numbered(name: string, i: number): string {
  if (i === 1) { return name; }
  const dot = name.lastIndexOf('.');
  return `${name.slice(0, dot)}-${i}${name.slice(dot)}`;
}

/**
 * The default name never replaces a file: the same subject rendered again
 * takes the next free number. The name is claimed by the write itself
 * (exclusive create), so two renders of one subject at once cannot land on
 * the same file. A given `out` replaces, as its description says.
 */
async function writeFree(name: string, root: string, bytes: Uint8Array): Promise<string> {
  for (let i = 1; ; i++) {
    const target = resolveOutputPath(numbered(name, i), root);
    try {
      await writeFile(target, bytes, { flag: 'wx' });
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') { throw new OutputWriteError(target, err); }
    }
  }
}

/**
 * Throws `OutsideSandboxError` when `input.out` escapes `root` — before any
 * rendering happens, so a refused request costs nothing and writes nothing.
 */
export async function renderToFile(
  input: LetterInput,
  defaults: CompanionDefaults,
  root: string,
): Promise<RenderedFile> {
  const format = input.format ?? 'pdf';
  // A given `out` is checked before the render; the default name is a slug
  // and cannot escape, so it is resolved at the write.
  const named = input.out === undefined ? undefined : resolveOutputPath(input.out, root);

  // Bound the render against the caller's patience rather than our own, and
  // cancel the work when the deadline wins: a wedged compile would otherwise
  // keep its worker for the life of the process.
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first so the caller gets the timeout, not the abort's own error.
      reject(new RenderTimeoutError(format, RENDER_TIMEOUT_MS));
      abort.abort();
    }, RENDER_TIMEOUT_MS);
  });
  const bytes = await Promise.race([
    format === 'pdf' ? renderPdf(input, defaults, { signal: abort.signal }) : renderDocx(input, defaults),
    deadline,
  ]).finally(() => clearTimeout(timer));
  let target = named ?? root;
  try {
    await mkdir(named ? dirname(named) : root, { recursive: true });
    if (named) { await writeFile(named, bytes); }
    else { target = await writeFree(filenameFor(input.subject, format), root, bytes); }
  } catch (err) {
    throw err instanceof OutputWriteError ? err : new OutputWriteError(target, err);
  }

  return { format, path: target, out: relative(resolve(root), target), bytes: bytes.byteLength };
}
