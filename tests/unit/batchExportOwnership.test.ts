import { afterEach, expect, it, vi } from 'vitest';
import { runPreparedBatchRow, confirmBatchExport, cancelBatchExport, clearBatchExports, type BatchExportReview } from '@/services/exports/batchExecution';
import { createExportArtifact, type ExportArtifact } from '@/lib/exportExecution';
import { copyPreparedDocument, type ReadyExportJob } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import type { BatchRowContext } from '@/services/exports/batchRows';

const context = (id = 'a', text = 'SSN {{ID}}', structure = false): BatchRowContext => ({ batchId: 'batch', rowId: id, filename: `${id}.pdf`, capturedAt: 1, source: {
  timestamp: 1, documentMode: 'compliant', documentCategory: 'correspondence', docType: 'standard_letter', formType: 'navmc_10274',
  formData: { subject: 'Original' }, paragraphs: [{ text, level: 0 }, ...(structure ? [{ text: 'Only child', level: 1 }] : [])], references: [], enclosures: [], copyTos: [], distributions: [],
} });
function setup() {
  let review: BatchExportReview | null = null;
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  const render = vi.fn<(ready: ReadyExportJob, signal: AbortSignal) => Promise<ExportArtifact>>(async ready => createExportArtifact(ready, new Blob(['pdf'])));
  const deliver = vi.fn<(artifact: ExportArtifact) => Promise<boolean>>(async () => true);
  const ports = { resolvePolicy: vi.fn(async () => policy), captureResources: vi.fn(async () => undefined), render, deliver,
    onReview: (value: BatchExportReview | null) => { review = value; } };
  return { ports, currentReview: () => { if (!review) throw new Error('Review missing');return review; } };
}
afterEach(() => { expect(clearBatchExports()).toBe(true); });
it('retries the same approved row even when a caller supplies new values and filename', async () => {
  const app = setup();const input = context();
  app.ports.render.mockRejectedValueOnce(new Error('Worker failed'));
  const first = runPreparedBatchRow({ ID: '123-45-6789' }, input, app.ports);const failed = expect(first).rejects.toThrow('Worker failed');
  await vi.waitFor(() => expect(app.currentReview().stage).toBe('privacy'));
  const review = app.currentReview();confirmBatchExport(review.job, review.stage);await failed;
  await runPreparedBatchRow({ ID: '987-65-4321' }, { ...input, filename: 'changed.pdf' }, app.ports);
  const ready = app.ports.render.mock.calls[1][0];expect(ready).toBe(app.ports.render.mock.calls[0][0]);
  expect(ready.job.filename).toBe('a.pdf');expect(copyPreparedDocument(ready).document.paragraphs[0].text).toBe('SSN 123-45-6789');
  expect(app.ports.resolvePolicy).toHaveBeenCalledTimes(1);
});
it('rejects stale row and stale stage confirmations', async () => {
  const app = setup();const input = { ...context('a', 'SSN {{ID}}', true) };
  const pending = runPreparedBatchRow({ ID: '123-45-6789' }, input, app.ports);input.rowId = 'changed';
  const cancelled = expect(pending).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(app.currentReview().stage).toBe('structure'));
  const first = app.currentReview();expect(first.rowId).toBe('a');expect(confirmBatchExport(first.job, first.stage)).toBe(true);
  expect(confirmBatchExport(first.job, first.stage)).toBe(false);expect(app.currentReview().stage).toBe('privacy');
  cancelBatchExport();await cancelled;
  const next = runPreparedBatchRow({ ID: '123-45-6789' }, context('b'), app.ports);const nextCancelled = expect(next).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(app.currentReview().rowId).toBe('b'));
  expect(confirmBatchExport(first.job, 'privacy')).toBe(false);cancelBatchExport();await nextCancelled;
  expect(app.ports.render).not.toHaveBeenCalled();
});
it('waits for a cancelled worker before releasing the row and suppresses delivery', async () => {
  const app = setup();let finish!: (artifact: ExportArtifact) => void;
  app.ports.render.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = runPreparedBatchRow({}, context('a', 'Body'), app.ports);const cancelled = expect(pending).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(app.ports.render).toHaveBeenCalledOnce());
  expect(cancelBatchExport()).toBe(true);expect(clearBatchExports()).toBe(false);
  expect(app.ports.deliver).not.toHaveBeenCalled();
  finish(createExportArtifact(app.ports.render.mock.calls[0][0], new Blob(['pdf'])));await cancelled;
  expect(app.ports.deliver).not.toHaveBeenCalled();
});
it('reconstructs approval after runtime recovery and revalidates deployment policy', async () => {
  const app = setup();const input = context();app.ports.render.mockRejectedValueOnce(new Error('Worker failed'));
  const first = runPreparedBatchRow({ ID: '123-45-6789' }, input, app.ports);const failed = expect(first).rejects.toThrow('Worker failed');
  await vi.waitFor(() => expect(app.currentReview().stage).toBe('privacy'));const old = app.currentReview();confirmBatchExport(old.job, old.stage);await failed;
  expect(clearBatchExports()).toBe(true);
  app.ports.resolvePolicy.mockResolvedValue(resolveExportDeploymentPolicy({ hostname: 'new.example.test', environment: null, runtime: { status: 'absent' } }));
  const resumed = runPreparedBatchRow({ ID: '123-45-6789' }, input, app.ports);
  await vi.waitFor(() => expect(app.currentReview().job).not.toBe(old.job));
  const review = app.currentReview();expect(review.job.policyIdentity).not.toBe(old.job.policyIdentity);
  expect(confirmBatchExport(old.job, old.stage)).toBe(false);confirmBatchExport(review.job, review.stage);await resumed;
  expect(app.ports.resolvePolicy).toHaveBeenCalledTimes(2);
});
it('does not cancel or release a row after the delivery handoff begins', async () => {
  const app = setup();let finish!: () => void;const cancelability = vi.fn();
  app.ports.deliver.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = () => resolve(true); }));
  const pending = runPreparedBatchRow({}, context('a', 'Body'), { ...app.ports, onCancelableChange: cancelability });
  await vi.waitFor(() => expect(app.ports.deliver).toHaveBeenCalledOnce());
  expect(cancelBatchExport()).toBe(false);expect(clearBatchExports()).toBe(false);expect(cancelability).toHaveBeenLastCalledWith(false);
  finish();await pending;
});
it('isolates presentation failures from execution completion', async () => {
  const app = setup();
  await expect(runPreparedBatchRow({}, context('a', 'Body'), { ...app.ports, onReview: () => { throw new Error('View gone'); } })).resolves.toEqual(expect.any(Uint8Array));
});
