import { sl3Fixture } from '../_helpers/sl3Fixture';
import { manualPacket } from '../_helpers/manualPacket';
import { expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderPreparedCorrespondence, type CorrespondenceRendererPorts, type ExportAssets } from '@/services/exports/correspondence';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { prepareExport, acknowledgePreparedExport, copyPreparedDocument, type ExportTarget, type ReadyExportJob } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { useDocumentStore } from '@/stores/documentStore';
import type { DocumentSnapshot } from '@/stores/historyStore';

function ready(target: ExportTarget, patch: Partial<DocumentSnapshot> = {}, capturedAt = 1): ReadyExportJob {
  const base = useDocumentStore.getState().getSnapshot();
  const captured = captureDocumentRevision({ documentId: 'render', epoch: 1, editSequence: 1, capturedAt }, { ...base, ...patch, formData: { ...base.formData, ...patch.formData } });
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'top_secret_sci', allowedLevels: [...CLASSIFICATION_LEVELS] }, runtime: { status: 'absent' } });
  const result = prepareExport({ captured, policy, target, id: 'render', filename: `source.${target}` });
  if (result.status === 'ready') return result.job;
  if (result.status === 'needs-review') return acknowledgePreparedExport(result.job);
  throw new Error(JSON.stringify(result));
}
async function pdf(pages = 1): Promise<Uint8Array> { const d = await PDFDocument.create();for (let i = 0; i < pages; i++) d.addPage().drawText(`Content ${i + 1}`);return d.save(); }
const noAssets: ExportAssets = { withAssets: async (_ids, operation) => operation(() => { throw new Error('Unexpected asset read'); }) };
function ports(bytes: Uint8Array): CorrespondenceRendererPorts {
  return { compile: vi.fn(async () => bytes), convertDocx: vi.fn(async () => new Blob(['DOCX'])), assets: noAssets };
}
it('keeps captured enclosure bytes instead of replacing them with later storage contents', async () => {
  const own = await pdf(2);const later = await pdf(1);const main = await pdf();
  const captured = ready('pdf', { enclosures: [{ title: 'Owned enclosure', file: { name: 'owned.pdf', size: own.byteLength, data: new Uint8Array(own).buffer }, fileRef: { id: 'attachment', name: 'owned.pdf', size: own.byteLength, type: 'application/pdf' } }] });
  const adapters = ports(main);
  const read = vi.fn(() => ({ id: 'attachment', name: 'later.pdf', size: later.byteLength, type: 'application/pdf', data: new Uint8Array(later).buffer }));
  adapters.assets = { withAssets: async (_ids, operation) => operation(read) };
  const artifact = await renderPreparedCorrespondence(captured, adapters, new AbortController().signal);
  expect((await PDFDocument.load(await artifact.blob.arrayBuffer())).getPageCount()).toBe(3);
  expect(read).not.toHaveBeenCalled();
});
it('passes the prepared classification to DOCX headers and post-processing options', async () => {
  const adapters = ports(await pdf());
  await renderPreparedCorrespondence(ready('docx', { formData: { classLevel: 'cui' }, paragraphs: [{ text: 'Source body', level: 0, portionMarking: 'S' }] }), adapters, new AbortController().signal);
  expect(adapters.convertDocx).toHaveBeenCalledWith(expect.stringContaining('SECRET'), expect.objectContaining({ classLevel: 'secret' }), undefined);
  expect(adapters.compile).not.toHaveBeenCalled();
});
it('includes the entire generated TeX inventory, including distributions', async () => {
  const artifact = await renderPreparedCorrespondence(ready('tex', { distributions: [{ text: 'Resolved distribution' }] }), ports(await pdf()), new AbortController().signal);
  expect(await artifact.blob.text()).toContain('distribution-config.tex');
  expect(await artifact.blob.text()).toContain('Resolved distribution');
  expect(artifact.job.filename).toBe('source.tex');
});
it('keeps resources borrowed until a cancelled compiler settles', async () => {
  const main = await pdf();const adapters = ports(main);const abort = new AbortController();
  let active = false;let finish!: (value: Uint8Array) => void;
  adapters.assets = { withAssets: async (_ids, operation) => { active = true;try { return await operation(() => { throw new Error('Unexpected read'); }); } finally { active = false; } } };
  adapters.compile = vi.fn(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
  const rendering = renderPreparedCorrespondence(ready('pdf'), adapters, abort.signal);
  await vi.waitFor(() => expect(adapters.compile).toHaveBeenCalledTimes(1));
  abort.abort();expect(active).toBe(true);
  finish(main);
  await expect(rendering).rejects.toThrow('cancelled');
  expect(active).toBe(false);
});


it('renders the same prepared publication dates after the wall clock changes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const capturedAt = Date.UTC(2026, 9, 1);
  try {
    vi.setSystemTime(capturedAt);
    const source = sl3Fixture(1);
    const job = ready('tex', { ...source, documentMode: 'compliant', documentCategory: 'correspondence' }, capturedAt);
    const adapters = ports(await pdf());
    const first = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
    vi.setSystemTime(Date.UTC(2090, 0, 1));
    const retried = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
    expect(await retried.blob.text()).toBe(await first.blob.text());
    expect(await retried.blob.text()).toContain('30 OCTOBER 2026');
  } finally { vi.useRealTimers(); }
});


it('excludes retained publication figures from an ordinary letter export', async () => {
  const job = ready('pdf', { docType: 'standard_letter', formData: { classLevel: 'unclassified' }, paragraphs: [{
    text: 'Ordinary paragraph after a format switch', level: 0,
    figure: { name: 'Previous publication image', type: 'image/png', portionMarking: 'S', fileRef: { id: 'missing-inactive-figure', name: 'old.png', type: 'image/png', size: 1 } },
  }] });
  const adapters = ports(await pdf());
  adapters.assets = { withAssets: async (ids, operation) => {
    if (ids.length) throw new Error('The retained publication image is unavailable.');
    return operation(() => { throw new Error('Unexpected asset read'); });
  } };
  const artifact = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
  expect((await PDFDocument.load(await artifact.blob.arrayBuffer())).getPageCount()).toBe(1);
  expect(copyPreparedDocument(job).document.formData.classLevel).toBe('unclassified');
  expect(adapters.compile).toHaveBeenCalledWith(expect.objectContaining({ 'body.tex': expect.stringContaining('Ordinary paragraph after a format switch') }));
});

it('keeps prepared manual cover dates fixed when rendering after a century boundary', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const capturedAt = Date.UTC(2026, 9, 1);
  try {
    vi.setSystemTime(capturedAt);
    const job = ready('tex', { ...manualPacket(), documentMode: 'compliant', documentCategory: 'correspondence' }, capturedAt);
    const adapters = ports(await pdf());
    const first = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
    vi.setSystemTime(Date.UTC(2090, 0, 1));
    const retried = await renderPreparedCorrespondence(job, adapters, new AbortController().signal);
    expect(await retried.blob.text()).toBe(await first.blob.text());
    expect(await retried.blob.text()).toContain('OCTOBER 2026');
  } finally { vi.useRealTimers(); }
});
it.each(['pdf', 'docx'] as const)('does not enter the %s engine after a progress observer cancels', async target => {
  const adapters = ports(await pdf()); const abort = new AbortController();
  adapters.onProgress = () => abort.abort();
  await expect(renderPreparedCorrespondence(ready(target), adapters, abort.signal)).rejects.toThrow('cancelled');
  expect(adapters.compile).not.toHaveBeenCalled(); expect(adapters.convertDocx).not.toHaveBeenCalled();
});
it.each(['pdf', 'docx'] as const)('keeps %s rendering independent of synchronous progress observer errors', async target => {
  const adapters = ports(await pdf()); adapters.onProgress = () => { throw new Error('Progress observer failed'); };
  const artifact = await renderPreparedCorrespondence(ready(target), adapters, new AbortController().signal);
  expect(artifact.completeness).toBe('complete');
});
it('handles async progress observer rejection without leaking unhandled promises', async () => {
  const unhandled: unknown[] = []; const record = (error: unknown) => { unhandled.push(error); };
  process.on('unhandledRejection', record);
  try {
    const adapters = ports(await pdf()); adapters.onProgress = async () => { throw new Error('Async progress failed'); };
    const artifact = await renderPreparedCorrespondence(ready('pdf'), adapters, new AbortController().signal);
    expect(artifact.completeness).toBe('complete');
    await new Promise(resolve => setTimeout(resolve, 0)); expect(unhandled).toEqual([]);
  } finally { process.off('unhandledRejection', record); }
});
it('isolates converter progress observers while retaining their phase notifications', async () => {
  const adapters = ports(await pdf());
  adapters.convertDocx = vi.fn(async (_latex, _options, progress) => { progress?.({ kind: 'preparing' }); return new Blob(['DOCX']); });
  adapters.onDocxProgress = () => { throw new Error('Converter observer failed'); };
  const artifact = await renderPreparedCorrespondence(ready('docx'), adapters, new AbortController().signal);
  expect(artifact.completeness).toBe('complete');
});

it('does not issue an artifact when final PDF progress cancels rendering', async () => {
  const adapters = ports(await pdf()); const abort = new AbortController();
  adapters.onProgress = phase => { if (phase === 'pdf-saving') abort.abort(); };
  await expect(renderPreparedCorrespondence(ready('pdf'), adapters, abort.signal)).rejects.toThrow('cancelled');
  expect(adapters.compile).toHaveBeenCalledTimes(1);
});
