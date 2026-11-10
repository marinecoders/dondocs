import { afterAll, beforeAll } from 'vitest';
import { createNodeEngine, loadAssets } from '../../companion/nodeEngine';
import { compileDocument, prepareEngine } from '@/services/latex/renderDocument';
import { generateAllLatexFiles } from '@/services/latex/generator';
import type { TestStore } from './compileLatex';

/** The packaged PDF engine, with no network font/package fallback. */
export function correspondenceRenderer() {
  let engine: Awaited<ReturnType<typeof createNodeEngine>>;
  const previous = process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY;
  beforeAll(async () => {
    process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY = '1';
    engine = await createNodeEngine();
    prepareEngine(engine, await loadAssets());
  }, 60_000);
  afterAll(async () => {
    if (previous === undefined) delete process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY;
    else process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY = previous;
    await engine?.dispose();
  });
  return (store: TestStore) => compileDocument(engine, generateAllLatexFiles(store).texFiles);
}
