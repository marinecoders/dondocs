/**
 * Render a document headlessly through the SAME core the browser uses.
 *
 * The point of this file is what it does NOT contain: no ordering, no preload
 * list, no prefix stripping. All of that is `prepareEngine` / `compileDocument`,
 * shared with the app. What is here is the host-specific part — start the
 * engine, read the assets off disk.
 *
 *   npx vite-node companion/render.ts -- out.pdf
 */
import { writeFile } from 'node:fs/promises';
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

// Direct invocation renders a sample so the path can be exercised by hand.
// vite-node rewrites argv, so key off an explicit flag rather than argv[1].
if (process.env.DONDOCS_RENDER_SAMPLE) {
  const out = process.env.DONDOCS_RENDER_SAMPLE;
  const pdf = await renderPdf({
    docType: 'naval_letter',
    subject: 'RENDERED THROUGH THE SHARED CORE',
    paragraphs: [
      { text: 'This letter was produced headlessly, with no browser involved.', level: 0 },
      { text: 'The compile sequence came from renderDocument, the same one the app uses.', level: 1 },
    ],
  });
  await writeFile(out, pdf);
  console.log(`  wrote ${out} (${pdf.byteLength} bytes)`);
}
