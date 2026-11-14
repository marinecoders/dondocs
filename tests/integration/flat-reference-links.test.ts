import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFDict, PDFString, PDFHexString } from 'pdf-lib';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { prepareExport, acknowledgePreparedExport } from '@/lib/preparedExport';
import { renderPreparedCorrespondence } from '@/services/exports/correspondence';
import { buildBaseline } from '../_helpers/compileMatrix';

const hasPdfLatex = spawnSync('pdflatex', ['--version']).status === 0;

describe.skipIf(!hasPdfLatex)('standalone flat LaTeX reference links', () => {
  it.each([
    { url: 'https://example.com/order_a?x=1&y=2#section', expected: 'https://example.com/order_a?x=1&y=2#section' },
    { url: 'https://example.com/a%20b/{section}/^/~/$/a_b?x=1&y=2#part', expected: 'https://example.com/a%20b/%7Bsection%7D/%5E/~/$/a_b?x=1&y=2#part' },
    { url: 'https://example.com/ZZZURLBACKSLASHZZZ/\\literal', expected: 'https://example.com/ZZZURLBACKSLASHZZZ/%5Cliteral' },
  ])('compiles a downloaded flat source and retains target $url', async ({ url, expected }) => {
    const store = buildBaseline('standard_memorandum');
    store.references = [{ letter: 'a', title: 'Linked source', url }, { letter: 'b', title: 'Plain source', url: 'javascript:alert(1)' }];
    const workDir = await mkdtemp(join(tmpdir(), 'dondocs-flat-links-'));
    const captured = captureDocumentRevision({ documentId: 'flat-reference-links', epoch: 1, editSequence: 1, capturedAt: 1 }, {
      ...useDocumentStore.getState().getSnapshot(), ...store, documentMode: 'compliant', documentCategory: 'correspondence',
    });
    const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
    const prepared = prepareExport({ captured, policy, target: 'tex', texMode: 'flat', id: 'flat-reference-links', filename: 'flat.tex' });
    if (prepared.status !== 'ready' && prepared.status !== 'needs-review') throw new Error(JSON.stringify(prepared));
    const artifact = await renderPreparedCorrespondence(prepared.status === 'ready' ? prepared.job : acknowledgePreparedExport(prepared.job), {
      compile: async () => { throw new Error('Flat export does not use the PDF engine'); },
      convertDocx: async () => { throw new Error('Flat export does not use the Word engine'); },
    }, new AbortController().signal);
    await writeFile(join(workDir, 'flat.tex'), await artifact.blob.text());
    const compiled = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'flat.tex'], {
      cwd: workDir, encoding: 'utf-8', timeout: 30_000,
    });
    expect(compiled.status, `${compiled.stdout}\n${compiled.stderr}\nWork directory: ${workDir}`).toBe(0);
    const pdf = await PDFDocument.load(await readFile(join(workDir, 'flat.pdf')));
    const links: string[] = [];
    for (const page of pdf.getPages()) {
      const annotations = page.node.Annots();
      for (let index = 0; index < (annotations?.size() ?? 0); index++) {
        const annotation = pdf.context.lookup(annotations!.get(index), PDFDict);
        const action = annotation.lookup(PDFName.of('A'), PDFDict);
        const uri = action?.lookup(PDFName.of('URI'));
        if (uri instanceof PDFString || uri instanceof PDFHexString) links.push(uri.decodeText());
      }
    }
    expect(links).toEqual([expected]);
  });
});
