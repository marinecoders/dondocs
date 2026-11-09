import { afterEach, expect, it, vi } from 'vitest';
import { openBrowserExportDelivery } from '@/utils/exportDelivery';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { prepareExport } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { createExportArtifact } from '@/lib/exportExecution';
const mocks = vi.hoisted(() => ({ preopen: vi.fn(), download: vi.fn() }));
vi.mock('@/utils/downloadPdf', () => ({ preOpenWindowForIOS: mocks.preopen, downloadPdfBlob: mocks.download }));
function artifact(target: 'pdf' | 'tex') {
  const captured = captureDocumentRevision({ documentId: 'a', epoch: 1, editSequence: 1, capturedAt: 1 }, { documentCategory: 'correspondence', documentMode: 'compliant', docType: 'standard_letter', formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {} });
  const result = prepareExport({ id: 'a', captured, target, filename: `original.${target}`, policy: resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }) });
  if (result.status !== 'ready') throw new Error('Expected ready');
  return createExportArtifact(result.job, new Blob(['output']));
}
afterEach(() => { vi.restoreAllMocks();vi.clearAllMocks();vi.useRealTimers(); });
it('reserves the PDF tab synchronously and closes an unused lease once', () => {
  const close = vi.fn();mocks.preopen.mockReturnValue({ close, closed: false });
  const lease = openBrowserExportDelivery('pdf');
  expect(mocks.preopen).toHaveBeenCalledTimes(1);lease.release();lease.release();
  expect(close).toHaveBeenCalledTimes(1);
});
it('transfers a successfully delivered tab without closing it', async () => {
  const close = vi.fn();mocks.preopen.mockReturnValue({ close, closed: false });mocks.download.mockResolvedValue(true);
  const lease = openBrowserExportDelivery('pdf');expect(await lease.deliver(artifact('pdf'))).toBe(true);lease.release();
  expect(close).not.toHaveBeenCalled();
});
it('reclaims a failed anchor URL and removes the anchor', async () => {
  const revoke = vi.fn();vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('Blocked'); });
  const lease = openBrowserExportDelivery('tex');await expect(lease.deliver(artifact('tex'))).rejects.toThrow('Blocked');lease.release();
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:export');expect(document.querySelector('a')).toBeNull();
});
