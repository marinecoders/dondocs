/**
 * Render a document headlessly through the SAME core the browser uses.
 *
 * The point of this file is what it does NOT contain: no ordering, no preload
 * list, no prefix stripping. All of that is `prepareEngine` / `compileDocument`,
 * shared with the app. What is here is the host-specific part — start the
 * engine, read the assets off disk.
 */
import { generateAllLatexFiles } from '@/services/latex/generator';
import { prepareEngine, compileDocument } from '@/services/latex/renderDocument';
import { createNodeEngine, loadAssets } from './nodeEngine';
import { toStore, type CompanionDefaults, type LetterInput } from './letterInput';

export type { LetterInput } from './letterInput';

export async function renderPdf(input: LetterInput, defaults: CompanionDefaults = {}): Promise<Uint8Array> {
  const engine = await createNodeEngine();
  try {
    prepareEngine(engine, await loadAssets());
    const { texFiles } = generateAllLatexFiles(toStore(input, defaults) as never);
    return await compileDocument(engine, texFiles);
  } finally {
    await engine.dispose();
  }
}
