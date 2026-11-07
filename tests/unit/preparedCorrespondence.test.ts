import { expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderPreparedCorrespondence, type CorrespondenceRendererPorts, type ExportAssets } from '@/services/exports/correspondence';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { prepareExport, acknowledgePreparedExport, type ExportTarget, type ReadyExportJob } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { useDocumentStore } from '@/stores/documentStore';
import type { DocumentSnapshot } from '@/stores/historyStore';

function ready(target: ExportTarget, patch: Partial<DocumentSnapshot> = {}): ReadyExportJob {
  const base = useDocumentStore.getState().getSnapshot();
  const captured = captureDocumentRevision({ documentId: 'render', epoch: 1, editSequence: 1, capturedAt: 1 }, { ...base, ...patch, formData: { ...base.formData, ...patch.formData } });
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
