/**
 * Render one document and put it on disk.
 *
 * The single step both transports share. HTTP and MCP differ only in how a
 * request arrives and how a result is phrased — the sandbox check, the render
 * and the write are the same work, and duplicating them is how two front doors
 * quietly grow two different security postures.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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
  bytes: number;
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
  const target = resolveOutputPath(input.out ?? filenameFor(input.subject, format), root);

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
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  } catch (err) {
    throw new OutputWriteError(target, err);
  }

  return { format, path: target, bytes: bytes.byteLength };
}
