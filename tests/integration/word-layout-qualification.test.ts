import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { prepareExport, acknowledgePreparedExport } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { renderPreparedCorrespondence } from '@/services/exports/correspondence';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { compileGeneratedDocxFixture } from '../_helpers/compileDocx';
import { compileGeneratedFixture } from '../_helpers/compileLatex';
import { hasPdfToolchain } from '../_helpers/pdfToolchain';
import { wordLayoutFixtures } from '../_helpers/wordLayoutQualification';

const hasPandoc = spawnSync('pandoc', ['--version']).status === 0;
const wordDirectory = process.env.DONDOCS_WORD_RENDERED_DIR;
function tool(command: string, args: string[]): string {
  const output = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (output.status !== 0) throw new Error(`${command} failed: ${output.stderr}`);
  return output.stdout;
}
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

describe.skipIf(!hasPandoc || !hasPdfToolchain)('Word layout qualification sources', () => {
  it('builds the same complete synthetic content for Word and native PDF inspection', async () => {
    const directory = process.env.DONDOCS_WORD_LAYOUT_ARTIFACTS ?? await mkdtemp(join(tmpdir(), 'dondocs-word-layout-'));
    await mkdir(directory, { recursive: true });
    const manifest = [];
    for (const fixture of await wordLayoutFixtures()) {
      const source = structuredClone(fixture.store);
      const captured = captureDocumentRevision({ documentId: fixture.name, epoch: 0, editSequence: 0, capturedAt: Date.UTC(2026, 10, 15) }, {
        ...source, documentMode: source.documentMode ?? 'compliant', documentCategory: 'correspondence',
        endItems: [], publicationTables: {},
      });
      const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
      const prepared = prepareExport({ id: fixture.name, captured, filename: `${fixture.name}.docx`, target: 'docx', policy });
      if (prepared.status !== 'ready' && prepared.status !== 'needs-review') throw new Error(prepared.issues.join('\n'));
      const ready = prepared.status === 'ready' ? prepared.job : acknowledgePreparedExport(prepared.job);
      const artifact = await renderPreparedCorrespondence(ready, {
        compile: async () => { throw new Error('Unexpected PDF compile'); },
        convertDocx: async (latex, options) => {
          const compiled = await compileGeneratedDocxFixture(latex, options, options.mediaFiles);
          expect(compiled.ok, compiled.log).toBe(true);
          return postProcessDocx(new Blob([new Uint8Array(compiled.docxBytes!)]), options);
        },
        assets: { withAssets: async (ids, operation) => operation(id => {
          if (id !== 'qualification-figure' || !fixture.figure || !ids.includes(id)) throw new Error('Unexpected figure read');
          return { id, name: 'figure.png', type: 'image/png', size: fixture.figure.length, data: new Uint8Array(fixture.figure).buffer };
        }) },
      }, new AbortController().signal);
      const word = new Uint8Array(await artifact.blob.arrayBuffer());
      const generated = generateAllLatexFiles(source);
      const assets: Record<string, Uint8Array> = {};
      if (generated.signatureImage) assets['attachments/signature.png'] = generated.signatureImage;
      for (const figure of generated.figures) assets[figure.file] = fixture.figure!;
      const pdf = await compileGeneratedFixture(generated.texFiles, assets, source.docType);
      expect(pdf.ok, pdf.logTail).toBe(true);
      const pdfPath = join(directory, `${fixture.name}-native.pdf`);
      await writeFile(pdfPath, pdf.pdfBytes!);
      await writeFile(join(directory, `${fixture.name}.docx`), word);
      const nativeBoxes = new DOMParser().parseFromString(tool('pdftotext', ['-bbox-layout', pdfPath, '-']), 'application/xml');
      const nativeTokens = [...nativeBoxes.getElementsByTagName('word')].map(word => word.textContent);
      for (const marker of fixture.markers) expect(nativeTokens.filter(token => token === marker), `${fixture.name}: ${marker}`).toHaveLength(1);
      manifest.push({ pipeline: 'native-pandoc', name: fixture.name, docxSha256: digest(word), nativePdfSha256: digest(pdf.pdfBytes!), markers: fixture.markers });
    }
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }, 120_000);
});

describe.skipIf(!wordDirectory)('actual Microsoft Word print qualification', () => {
  it('retains every marker and the measured continuation margins', async () => {
    const manifest = JSON.parse(await readFile(join(wordDirectory!, 'manifest.json'), 'utf8')) as Array<{ pipeline: 'native-pandoc' | 'browser-wasm'; docxFile?: 'naval-deep-browser.docx'; name: string; docxSha256: string; nativePdfSha256: string; wordPdfSha256: string }>;
    for (const fixture of await wordLayoutFixtures()) {
      const receipt = manifest.find(entry => entry.name === fixture.name);
      expect(receipt).toBeDefined();
      expect(['native-pandoc', 'browser-wasm']).toContain(receipt!.pipeline);
      if (receipt!.pipeline === 'browser-wasm') {
        const browser = JSON.parse(await readFile(join(wordDirectory!, 'browser-source.json'), 'utf8')) as { pipeline: string; docxSha256: string; project: string };
        expect(browser.pipeline).toBe('browser-wasm');
        expect(browser.project).toBeTruthy();
        expect(browser.docxSha256).toBe(receipt!.docxSha256);
      }
      expect(receipt!.wordPdfSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt!.nativePdfSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(digest(await readFile(join(wordDirectory!, receipt!.docxFile ?? `${fixture.name}.docx`)))).toBe(receipt!.docxSha256);
      const nativePath = join(wordDirectory!, `${fixture.name}-native.pdf`);
      expect(digest(await readFile(nativePath))).toBe(receipt!.nativePdfSha256);
      const path = join(wordDirectory!, `${fixture.name}-word.pdf`);
      const metadata = tool('pdfinfo', [path]);
      expect(metadata).toMatch(/Creator:\s+Word\b/);
      expect(metadata).toMatch(/Page size:\s+612 x 792 pts/);
      const boxes = new DOMParser().parseFromString(tool('pdftotext', ['-bbox-layout', path, '-']), 'application/xml');
      const words = [...boxes.getElementsByTagName('word')];
      expect(words.length).toBeGreaterThan(100);
      for (const marker of fixture.markers) expect(words.filter(word => word.textContent === marker), `${fixture.name}: ${marker}`).toHaveLength(1);
      const native = new DOMParser().parseFromString(tool('pdftotext', ['-bbox-layout', nativePath, '-']), 'application/xml');
      expect(boxes.getElementsByTagName('page')).toHaveLength(native.getElementsByTagName('page').length);
      if (fixture.name === 'business-figure') {
        const nativeWords = [...native.getElementsByTagName('word')];
        for (let index = 0; index < 8; index++) {
          const marker = `BUSINESS${index}`;
          const line = words.find(word => word.textContent === marker)!.parentElement!;
          const nativeLine = nativeWords.find(word => word.textContent === marker)!.parentElement!;
          const expected = `${index + 1}.`;
          expect(nativeLine.getElementsByTagName('word')[0].textContent).toBe(expected);
          expect(line.getElementsByTagName('word')[0].textContent).toBe(expected);
        }
      }
      if (fixture.name === 'naval-long-references') {
        const pages = [...boxes.getElementsByTagName('page')];
        const referencePages = pages.filter(page => page.textContent?.includes('LONGREFERENCE'));
        expect(referencePages.length).toBeGreaterThan(1);
        for (let index = 0; index < 24; index++) {
          expect(words.filter(word => word.textContent === `LONGREFERENCE${index}`)).toHaveLength(1);
        }
      }
      if (fixture.name === 'naval-deep') {
        const pages = [...boxes.getElementsByTagName('page')];
        expect(pages.length).toBeGreaterThan(2);
        const nativeWords = [...native.getElementsByTagName('word')];
        const lines: Element[] = [...boxes.getElementsByTagName('line')];
        for (let level = 0; level < 6; level++) {
          const marker = words.find(word => word.textContent === `DEPTH${level}`);
          const nativeMarker = nativeWords.find(word => word.textContent === `DEPTH${level}`);
          expect(marker, `Missing level ${level}`).toBeDefined();
          expect(nativeMarker).toBeDefined();
          expect(Math.abs(Number(marker!.getAttribute('xMin')) - Number(nativeMarker!.getAttribute('xMin')))).toBeLessThan(2);
          const line = marker!.parentElement!;
          const wrap = lines[lines.indexOf(line) + 1];
          expect(wrap, `Missing continuation line for level ${level}`).toBeDefined();
          expect(Number(wrap.getAttribute('xMin'))).toBeGreaterThanOrEqual(71.5);
          expect(Number(wrap.getAttribute('xMin'))).toBeLessThan(73);
        }
        // Compare actual printed glyph positions, not just OOXML spacing.
        const nativePages = [...native.getElementsByTagName('page')];
        expect(pages).toHaveLength(nativePages.length);
        for (let index = 1; index < pages.length; index++) {
          const wordLines = [...pages[index].getElementsByTagName('line')];
          const nativeLines = [...nativePages[index].getElementsByTagName('line')];
          const header = wordLines.find(line => line.textContent?.includes('Subj:'))!;
          const nativeHeader = nativeLines.find(line => line.textContent?.includes('Subj:'))!;
          const headerY = Number(header.getAttribute('yMin'));
          expect(headerY).toBeGreaterThan(59);
          expect(Math.abs(headerY - Number(nativeHeader.getAttribute('yMin')))).toBeLessThan(2);
          expect(Math.abs(Number(wordLines[1].getAttribute('yMin')) - Number(nativeLines[1].getAttribute('yMin')))).toBeLessThan(2);
          const gap = Number(wordLines[1].getAttribute('yMin')) - headerY;
          expect(gap).toBeGreaterThan(24);
          expect(gap).toBeLessThan(32);
          const footer = [...pages[index].getElementsByTagName('word')].filter(word => Number(word.getAttribute('yMin')) > 730);
          expect(footer.map(word => word.textContent)).toEqual([String(index + 1)]);
        }
      }
      const bytes = await readFile(path);
      expect(bytes.length).toBeGreaterThan(1_000);
      expect(digest(bytes)).toBe(receipt!.wordPdfSha256);
    }
  });
});
