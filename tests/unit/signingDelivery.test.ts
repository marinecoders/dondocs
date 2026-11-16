import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { prepareExport, acknowledgePreparedExport } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { createExportArtifact } from '@/lib/exportExecution';
import { retainSigningExport } from '@/services/exports/signingDelivery';
import { subscribeSigningCapture } from '@/lib/signingCaptureEvents';
import { listSigningRecords, signingDigest } from '@/lib/signingWorkspace';

async function artifact(partial = false) {
  const pdf = await PDFDocument.create();pdf.addPage();const bytes = await pdf.save();
  const captured = captureDocumentRevision({ documentId: 'exact-export-source', epoch: 2, editSequence: 6, capturedAt: 200 }, {
    documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter', formData: { subject: 'Training source' },
    paragraphs: [{ level: 0, text: 'Training body' }], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  });
  const preparation = prepareExport({ id: crypto.randomUUID(), captured, target: 'pdf', filename: 'Exact.pdf',
    policy: resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }) });
  if ('issues' in preparation) throw new Error(preparation.issues.join(', '));
  const ready = preparation.status === 'ready' ? preparation.job : acknowledgePreparedExport(preparation.job);
  return { bytes, artifact: createExportArtifact(ready, new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), partial ? [{ message: 'Missing enclosure' }] : []) };
}
it('retains precisely the issued PDF and its source identity after reviewed delivery', async () => {
  const value = await artifact(), listener = vi.fn(), unsubscribe = subscribeSigningCapture(listener);
  try {
    const saved = await retainSigningExport(value.artifact, () => true);
    expect(saved.source.sha256).toBe(await signingDigest(value.bytes));
    expect(saved.sourceRevision).toEqual(value.artifact.job.source);expect(listener).toHaveBeenCalledWith(saved.id);
  } finally { unsubscribe(); }
});
it('does not retain partial or cancelled export output', async () => {
  const before = await listSigningRecords();
  await expect(retainSigningExport((await artifact(true)).artifact, () => true)).rejects.toThrow('complete reviewed');
  await expect(retainSigningExport((await artifact()).artifact, () => false)).rejects.toThrow('complete reviewed');
  expect(await listSigningRecords()).toEqual(before);
});
