import { describe, expect, it, vi } from 'vitest';
import { PDFDict, PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { acknowledgePreparedExport, copyPreparedDocument, prepareExport, type ReadyExportJob } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { renderPreparedCorrespondence, type CorrespondenceRendererPorts } from '@/services/exports/correspondence';
import { loadTaggedSeal } from '@/services/pdf/accessibility/render';
import type { DocumentSnapshot } from '@/stores/historyStore';

const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
const source: DocumentSnapshot = { docType: 'standard_letter', documentCategory: 'correspondence', documentMode: 'compliant',
  formData: { subject: 'OWNED SUBJECT', from: 'Training Marine', to: 'Training Office', date: '16 Nov 26', signatureType: 'none' },
  paragraphs: [{ text: 'OWNED BODY', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {} };
function prepare(document = source, profile: 'tagged' | undefined = 'tagged') {
  return prepareExport({ id: 'tagged', filename: 'training-tagged.pdf', target: 'pdf', pdfAccessibility: profile, policy,
    captured: captureDocumentRevision({ documentId: 'owned', epoch: 1, editSequence: 1, capturedAt: 1 }, document) });
}
function ready(document = source): ReadyExportJob {
  const result = prepare(document);
  if (result.status === 'ready') return result.job;
  if (result.status === 'needs-review') return acknowledgePreparedExport(result.job);
  throw new Error(JSON.stringify(result));
}

// This adapter exercises ownership and delivery, not TeX layout. Actual compiler
// layout and resource proof lives in the retained multi-page qualification.
async function compiledPoints(files: Record<string, string | Uint8Array>) {
  const text = Object.values(files).filter((value): value is string => typeof value === 'string').join('\n');
  const nonce = /\/N <([a-f0-9]{32})>/.exec(text)![1];
  const ids = [...new Set([...text.matchAll(/\/I (\d+) \/B true/g)].map(match => Number(match[1])))];
  const pdf = await PDFDocument.create(); const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F1: font.ref } }));
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(ids.map(id => `/DDTag << /N <${nonce}> /I ${id} /B true >> DP\nBT /F1 12 Tf 50 700 Td (Content ${id}) Tj ET\n/DDTag << /N <${nonce}> /I ${id} /B false >> DP`).join('\n'))));
  return pdf.save();
}
function ports(compile = vi.fn(compiledPoints)): CorrespondenceRendererPorts {
  return { compile, convertDocx: vi.fn(), assets: { withAssets: async (ids, run) => { expect(ids).toEqual([]); return run(() => { throw new Error('Unexpected asset'); }); } } };
}

describe('reviewed tagged PDF export', () => {
  it('captures the profile with the exact approved document and actually returns PDF structure', async () => {
    const document = structuredClone(source); const job = ready(document);
    document.formData.subject = 'LATER SUBJECT'; document.paragraphs[0].text = 'LATER BODY';
    const adapters = ports();
    const artifact = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
    const pdf = await PDFDocument.load(await artifact.blob.arrayBuffer());
    expect(pdf.getTitle()).toBe('OWNED SUBJECT');
    expect(pdf.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict)).toBeInstanceOf(PDFDict);
    expect(adapters.compile).toHaveBeenCalledWith(expect.objectContaining({ 'body.tex': expect.stringContaining('OWNED BODY') }), 'tagged-correspondence');
    expect(copyPreparedDocument(job).document.formData.subject).toBe('OWNED SUBJECT');
    expect(job.job.pdfAccessibility).toBe('tagged');
  });

  it.each([
    { enclosures: [{ title: 'Retained original' }] },
    { docType: 'business_letter' },
    { formData: { ...source.formData, signatureType: 'digital' as const } },
    { formData: { ...source.formData, classLevel: 'cui' as const } },
  ])('refuses unsupported source before any ordinary-PDF fallback %j', patch => {
    expect(prepare({ ...source, ...patch })).toMatchObject({ status: 'error' });
  });

  it('awaits the cancelled compiler, releases the owned resources and returns no PDF', async () => {
    let finish!: (value: Uint8Array) => void; let active = false;
    const compile = vi.fn(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
    const adapters = ports(compile); const abort = new AbortController();
    adapters.assets = { withAssets: async (_ids, run) => { active = true; try { return await run(() => { throw new Error('Unexpected asset'); }); } finally { active = false; } } };
    const pending = renderPreparedCorrespondence(ready(), adapters, abort.signal);
    await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce()); abort.abort();
    expect(active).toBe(true); finish(new Uint8Array([1]));
    await expect(pending).rejects.toThrow('cancelled'); expect(active).toBe(false);
  });

  it('rejects unknown tagged profiles for non-PDF targets', () => {
    const captured = captureDocumentRevision({ documentId: 'owned', epoch: 1, editSequence: 1, capturedAt: 1 }, source);
    expect(prepareExport({ id: 'invalid', filename: 'file.docx', target: 'docx', pdfAccessibility: 'tagged', captured, policy })).toMatchObject({ status: 'error' });
  });

  it('bounds actual streamed seal bytes even when a server omits its content length', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close(); } })));
    try { await expect(loadTaggedSeal('dow-seal.png', new AbortController().signal)).rejects.toThrow(/exceeds/); }
    finally { fetcher.mockRestore(); }
    await expect(loadTaggedSeal('../private.png', new AbortController().signal)).rejects.toThrow(/Unsupported/);
  });
});
