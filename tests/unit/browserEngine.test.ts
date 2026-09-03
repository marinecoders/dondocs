import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { prepareEngine, compileDocument } from '@/services/latex/renderDocument';
import { createNodeEngine, loadAssets } from '../../companion/nodeEngine';

// The render suites compile with a full TeX Live, so they cannot see a package
// the browser lacks. This drives the vendored pdfTeX wasm the browser runs,
// preloaded with the same bundle, and serves it nothing else -- an offline
// PWA has exactly that. A `\usepackage` the bundle does not carry fails here
// the way it fails in the preview: "File `x.sty' not found".
describe('the browser engine, from the bundle alone', () => {
  let engine: Awaited<ReturnType<typeof createNodeEngine>>;

  beforeAll(async () => {
    process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY = '1';
    engine = await createNodeEngine();
    prepareEngine(engine, await loadAssets());
  }, 60_000);

  afterAll(async () => {
    delete process.env.DONDOCS_TEXLIVE_BUNDLE_ONLY;
    await engine.dispose();
  });

  const compile = async (docType: 'i_type' | 'naval_letter') => {
    useDocumentStore.getState().resetForm();
    useDocumentStore.getState().setDocType(docType);
    const { texFiles } = generateAllLatexFiles(useDocumentStore.getState());
    return compileDocument(engine, texFiles);
  };

  it('compiles a fresh I-Type Instruction', async () => {
    const pdf = await compile('i_type');
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
  }, 120_000);

  it('compiles a fresh naval letter', async () => {
    const pdf = await compile('naval_letter');
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
  }, 120_000);
});
