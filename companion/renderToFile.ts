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

  // Bound the render against the caller's patience rather than our own. The
  // losing branch does not cancel the work — the engine finishes and disposes
  // on its own — but the caller stops waiting and is told why, which is the
  // part that matters to an agent with no timeout of its own.
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderTimeoutError(format, RENDER_TIMEOUT_MS)), RENDER_TIMEOUT_MS);
  });
  const bytes = await Promise.race([
    format === 'pdf' ? renderPdf(input, defaults) : renderDocx(input, defaults),
    deadline,
  ]).finally(() => clearTimeout(timer));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);

  return { format, path: target, bytes: bytes.byteLength };
}
