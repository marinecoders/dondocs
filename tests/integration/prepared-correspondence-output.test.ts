import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { prepareExport, acknowledgePreparedExport, type ExportTarget } from '@/lib/preparedExport';
import { renderPreparedCorrespondence, type CorrespondenceRendererPorts } from '@/services/exports/correspondence';
import { postProcessDocx } from '@/services/docx/pandoc-converter';
import { compileGeneratedFixture } from '../_helpers/compileLatex';
import { compileGeneratedDocxFixture } from '../_helpers/compileDocx';
import { hasPdfToolchain, describeToolchainRequirement } from '../_helpers/pdfToolchain';

describe('prepared correspondence output', () => {
  describeToolchainRequirement('prepared correspondence');
  it.skipIf(!hasPdfToolchain).each([
    { level: 'cui', portion: 'S' as const, text: undefined, expected: 'SECRET' },
    { level: 'custom', portion: undefined, text: 'CUI//TEST', expected: 'CUI//TEST' },
  ])('uses $expected consistently in PDF, enclosures, and final Word headers', async scenario => {
    const enclosure = await PDFDocument.create();enclosure.addPage().drawText('Enclosure payload');
    const bytes = await enclosure.save();
    const base = useDocumentStore.getState().getSnapshot();
    const captured = captureDocumentRevision({ documentId: 'native-output', epoch: 1, editSequence: 1, capturedAt: 1 }, {
      ...base, docType: 'naval_letter', documentCategory: 'correspondence',
      formData: { ...base.formData, subject: 'CAPTURED OUTPUT', classLevel: scenario.level, customClassification: scenario.text, signatureType: 'digital', includeHyperlinks: true },
      paragraphs: [{ text: 'Captured source text.', level: 0, portionMarking: scenario.portion }],
      enclosures: [{ title: 'Captured attachment', file: { name: 'attachment.pdf', size: bytes.byteLength, data: new Uint8Array(bytes).buffer } }],
    });
    const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'top_secret_sci', allowedLevels: [...CLASSIFICATION_LEVELS] }, runtime: { status: 'absent' } });
    const renderPorts: CorrespondenceRendererPorts = {
      compile: async files => {
        const tex: Record<string, string> = {};const binary: Record<string, Uint8Array> = {};
        for (const [name, value] of Object.entries(files)) { if (typeof value === 'string') tex[name] = value;else binary[name] = value; }
        const compiled = await compileGeneratedFixture(tex, binary);
        if (!compiled.ok || !compiled.pdfBytes) throw new Error(compiled.logTail);
        return compiled.pdfBytes;
      },
      convertDocx: async (latex, options) => {
        const compiled = await compileGeneratedDocxFixture(latex, options);
        if (!compiled.ok || !compiled.docxBytes) throw new Error(compiled.log);
        return postProcessDocx(new Blob([new Uint8Array(compiled.docxBytes)]), options);
      },
    };
    const render = async (target: ExportTarget) => {
      const result = prepareExport({ captured, policy, target, id: `native-${target}`, filename: `captured.${target}` });
      if (result.status !== 'ready' && result.status !== 'needs-review') throw new Error(JSON.stringify(result));
      return renderPreparedCorrespondence(result.status === 'ready' ? result.job : acknowledgePreparedExport(result.job), renderPorts, new AbortController().signal);
    };
    const pdf = await render('pdf');
    expect(pdf.completeness).toBe('complete');
    expect((await PDFDocument.load(await pdf.blob.arrayBuffer())).getPageCount()).toBe(2);
    const directory = await mkdtemp(join(tmpdir(), 'dondocs-prepared-output-'));const file = join(directory, 'output.pdf');
    await writeFile(file, new Uint8Array(await pdf.blob.arrayBuffer()));
    const extracted = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
    expect(extracted.status).toBe(0);
    const pages = extracted.stdout.split('\f').filter(page => page.trim());
    expect(pages).toHaveLength(2);
    for (const page of pages) expect(page).toContain(scenario.expected);
    const docx = await render('docx');const zip = await JSZip.loadAsync(await docx.blob.arrayBuffer());
    const headers = await Promise.all(Object.keys(zip.files).filter(name => /^word\/(?:header|footer).*\.xml$/.test(name)).map(name => zip.file(name)!.async('string')));
    expect(headers.length).toBeGreaterThan(0);
    for (const xml of headers) expect(xml).toContain(scenario.expected);
    expect(await zip.file('word/document.xml')!.async('string')).toContain('Captured source text.');
  });
});
