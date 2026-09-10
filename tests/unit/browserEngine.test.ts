import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { useDocumentStore, type DocumentState } from '@/stores/documentStore';
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

  const compile = async (docType: 'i_type' | 'naval_letter', extra: Partial<DocumentState> = {}) => {
    useDocumentStore.getState().resetForm();
    useDocumentStore.getState().setDocType(docType);
    useDocumentStore.setState(extra);
    const { texFiles } = generateAllLatexFiles(useDocumentStore.getState());
    return compileDocument(engine, texFiles);
  };

  it('compiles a fresh I-Type Instruction', async () => {
    const pdf = await compile('i_type');
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
  }, 120_000);

  // A package can load and still not run: a longtable from a 2024 TeX Live
  // reaches for kernel hooks this engine's format predates, and only
  // \begin{longtable} finds out. Seven end items open one on the cover.
  it('compiles an I-Type whose tables break across pages', async () => {
    const pdf = await compile('i_type', {
      endItems: Array.from({ length: 7 }, (_, i) => ({ nsn: `1005-01-566-110${i}`, tamcn: `A0255${i}G`, id: `1103${i}A`, model: `M40A6-${i}` })),
      paragraphs: [{ text: '', level: 0, header: 'Major Items Affected', tableKey: 'majorItems' }],
      publicationTables: {
        majorItems: [{ values: { description: 'RIFLE, 7.62MM, M40A6', nsn: '1005-01-566-1100', tamcn: 'A02550G', id: '11030A' } }],
      },
    });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
  }, 120_000);

  it('compiles a fresh naval letter', async () => {
    const pdf = await compile('naval_letter');
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
  }, 120_000);
});
