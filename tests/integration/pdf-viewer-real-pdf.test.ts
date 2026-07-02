/**
 * The in-app PDF viewer against REAL compiled output.
 *
 * Every other viewer test mocks react-pdf; this one closes the loop the mocks
 * can't: it compiles an actual letter with pdflatex, then parses the bytes
 * with the EXACT pdf.js react-pdf ships (resolved through react-pdf's nested
 * pdfjs-dist — the same resolution scripts/sync-pdf-worker.mjs vendors the
 * worker from), under the viewer's own hardened options. It then feeds the
 * real page geometry into the viewer's layout math.
 *
 * What this proves that the mocked tests can't:
 *  - the generator's PDFs open in the shipped pdf.js (no version/format skew),
 *  - CVE hardening (isEvalSupported: false) doesn't break real documents,
 *  - the viewer's US-Letter placeholder aspect matches real output exactly,
 *  - virtualization math holds on real multi-page geometry, not synthetic.
 *
 * Skipped when pdflatex is absent (same guard as the rest of the harness);
 * the compile-matrix CI job provides it.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFixture } from '../_helpers/compileLatex';
import { buildBaseline } from '../_helpers/compileMatrix';
import {
  computePageLayout,
  visibleRange,
  currentPage,
  DEFAULT_PAGE_ASPECT,
} from '@/components/pdf/pdfMath';
import { HARDENED_PDF_OPTIONS } from '@/components/pdf/pdfConfig';

const pdflatexAvailable =
  spawnSync('pdflatex', ['--version'], { encoding: 'utf-8' }).status === 0;

// Resolve the pdfjs-dist copy react-pdf actually runs (nested under its own
// node_modules — other packages pin different majors), and load its Node entry.
const req = createRequire(import.meta.url);
const reactPdfPkg = req.resolve('react-pdf/package.json');
const reqFromReactPdf = createRequire(reactPdfPkg);
const pdfjsPkgPath = reqFromReactPdf.resolve('pdfjs-dist/package.json');
const pdfjsDir = dirname(pdfjsPkgPath);
const pdfjsVersion: string = JSON.parse(readFileSync(pdfjsPkgPath, 'utf8')).version;

async function loadViewerPdfjs() {
  return import(pathToFileURL(join(pdfjsDir, 'legacy', 'build', 'pdf.mjs')).href);
}

async function parseWithViewerPdfjs(pdfBytes: Uint8Array) {
  const pdfjs = await loadViewerPdfjs();
  return pdfjs.getDocument({
    // compileFixture returns a Node Buffer; pdf.js 5 rejects Buffer subclasses.
    data: new Uint8Array(pdfBytes),
    // The viewer's hardening + node-friendly font handling.
    ...HARDENED_PDF_OPTIONS,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
}

describe('PDF viewer × real compiled documents', () => {
  it.skipIf(!pdflatexAvailable)(
    'a real naval letter opens in the shipped pdf.js with the geometry the viewer assumes',
    async () => {
      const result = await compileFixture(buildBaseline('naval_letter'));
      expect(result.ok, result.errors.join('\n') || result.logTail).toBe(true);

      const doc = await parseWithViewerPdfjs(result.pdfBytes!);
      expect(doc.numPages).toBeGreaterThanOrEqual(1);

      // US Letter at 72dpi — and exactly the placeholder aspect the viewer
      // sizes unresolved pages with (612/792 === 8.5/11).
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      expect(vp.width).toBeCloseTo(612, 0);
      expect(vp.height).toBeCloseTo(792, 0);
      expect(vp.width / vp.height).toBeCloseTo(DEFAULT_PAGE_ASPECT, 10);

      // The subject the fixture set is really in the rendered text layer —
      // the same data the preview draws.
      const text = (await page.getTextContent()).items
        .map((i: { str?: string }) => i.str ?? '')
        .join(' ');
      expect(text).toContain('OPERATIONAL READINESS REPORT');

      await doc.destroy();
    },
    30_000
  );

  it.skipIf(!pdflatexAvailable)(
    'multi-page output drives the virtualization math correctly',
    async () => {
      const store = buildBaseline('naval_letter');
      store.paragraphs = Array.from({ length: 18 }, (_, i) => ({
        text:
          `Paragraph ${i + 1}. ` +
          'All personnel shall comply with the provisions of this correspondence in every particular and report completion through the chain of command. '.repeat(
            4
          ),
        level: 0,
      }));
      const result = await compileFixture(store);
      expect(result.ok, result.errors.join('\n') || result.logTail).toBe(true);

      const doc = await parseWithViewerPdfjs(result.pdfBytes!);
      expect(doc.numPages).toBeGreaterThanOrEqual(2);

      // Real per-page aspects → the viewer's layout, exactly as PdfPageLayer
      // computes it after onLoadSuccess.
      const aspects: number[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
        aspects.push(vp.width / vp.height);
      }
      const pageWidth = 600;
      const layout = computePageLayout(aspects, pageWidth, 16, 24);
      expect(layout).toHaveLength(doc.numPages);
      // Pages stack strictly downward with positive heights.
      for (let i = 0; i < layout.length; i++) {
        expect(layout[i].height).toBeGreaterThan(0);
        if (i > 0) expect(layout[i].top).toBeGreaterThan(layout[i - 1].top + layout[i - 1].height - 1);
      }
      // At the top of the scroll, page 1 is in view; centered on the last
      // page's band, the indicator reports the last page.
      expect(visibleRange(0, 800, layout, 0)[0]).toBe(0);
      const last = layout[layout.length - 1];
      expect(currentPage(last.top + 10, 100, layout)).toBe(doc.numPages);

      await doc.destroy();
    },
    30_000
  );

  it('the shipped pdf.js version matches the vendored worker exactly', () => {
    // pdf.js hard-fails at runtime on worker/API version skew. The CI job
    // re-vendors and diffs the worker file; this assertion pins the OTHER
    // half — the version the viewer stamps into its workerSrc ?v= parameter
    // resolves from the same nested package this test just exercised.
    const workerBytes = readFileSync(join(pdfjsDir, 'build', 'pdf.worker.min.mjs'));
    const vendored = readFileSync(
      join(dirname(req.resolve('react-pdf/package.json')), '..', '..', 'public', 'lib', 'pdf.worker.min.mjs')
    );
    expect(pdfjsVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(vendored.equals(workerBytes)).toBe(true);
  });
});
