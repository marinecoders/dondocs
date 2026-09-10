/**
 * Render a document headlessly through the SAME core the browser uses.
 *
 * The point of this file is what it does NOT contain: no ordering, no preload
 * list, no prefix stripping. All of that is `prepareEngine` / `compileDocument`,
 * shared with the app. What is here is the host-specific part — start the
 * engine, read the assets off disk.
 */
import { generateAllLatexFiles } from '@/services/latex/generator';
import { prepareEngine, compileDocument, LatexCompileError } from '@/services/latex/renderDocument';
import { createNodeEngine, loadAssets } from './nodeEngine';
import { toStore, type CompanionDefaults, type LetterInput } from './letterInput';

export type { LetterInput } from './letterInput';

/**
 * The first line TeX marked as an error.
 *
 * `LatexCompileError.message` says only "LaTeX compilation failed (status N)".
 * The cause sits in the log and reads plainly enough to pass through as-is:
 * `File 'memorandum.tex' not found`. Bounded, because this rides back in a tool
 * result.
 */
export function firstTexError(log: string): string {
  const line = log.split('\n').find((l) => l.startsWith('!'));
  return line ? line.replace(/^!\s*/, '').trim().slice(0, 200) : '';
}

export async function renderPdf(input: LetterInput, defaults: CompanionDefaults = {}): Promise<Uint8Array> {
  const engine = await createNodeEngine();
  try {
    prepareEngine(engine, await loadAssets());
    const { texFiles } = generateAllLatexFiles(toStore(input, defaults) as never);
    return await compileDocument(engine, texFiles);
  } catch (err) {
    // Here rather than in each transport: neither front door should have to know
    // what TeX is. `needsReset` keeps its sentinel — that one is matched, not read.
    if (err instanceof LatexCompileError && !err.needsReset) {
      const cause = firstTexError(err.log);
      if (cause) { throw new Error(`${err.message}: ${cause}`, { cause: err }); }
    }
    throw err;
  } finally {
    await engine.dispose();
  }
}
