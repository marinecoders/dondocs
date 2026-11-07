import { expect, it, vi } from 'vitest';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { copyPreparedDocument, type ReadyExportJob } from '@/lib/preparedExport';
import { createExportArtifact, type ExportArtifact } from '@/lib/exportExecution';
import { createExportController, createExportGate, type ExportIntent } from '@/lib/exportController';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
function intent(id = 'original', structure = false): ExportIntent {
  return { id, target: 'pdf', filename: `${id}.pdf`, captured: captureDocumentRevision({ documentId: id, epoch: 1, editSequence: 1, capturedAt: 1 }, {
    documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formData: { subject: id },
    paragraphs: [{ text: 'SSN 123-45-6789', level: 0 }, ...(structure ? [{ text: 'Only child', level: 1 }] : [])], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {},
  }) };
}
function setup() {
  const deliver = vi.fn<(artifact: ExportArtifact) => Promise<boolean>>(async () => true);const release = vi.fn();const gate = createExportGate();
  const render = vi.fn<(ready: ReadyExportJob, signal: AbortSignal) => Promise<ExportArtifact>>(async ready => createExportArtifact(ready, new Blob([copyPreparedDocument(ready).document.formData.subject ?? ''])));
  const ports = { gate, captureResources: vi.fn(async () => undefined), resolvePolicy: vi.fn(async () => policy), openDelivery: vi.fn(() => ({ deliver, release })), render };
  return { ...ports, deliver, release, controller: createExportController(ports) };
}
it('reviews and retries the same captured document, filename, and policy', async () => {
  const app = setup();app.controller.request(intent());
  await vi.waitFor(() => expect(app.controller.getState().phase).toBe('review'));
  const review = app.controller.getState();if (review.phase !== 'review') throw new Error('Review missing');
  app.deliver.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  app.controller.confirm(review.job, review.stage);
  await vi.waitFor(() => expect(app.controller.getState().phase).toBe('error'));
  expect(app.controller.retry()).toBe(true);
  await vi.waitFor(() => expect(app.controller.getState().phase).toBe('success'));
  expect(app.render.mock.calls[0][0]).toBe(app.render.mock.calls[1][0]);
  expect(app.deliver.mock.calls[1][0].job.filename).toBe('original.pdf');
  expect(app.resolvePolicy).toHaveBeenCalledTimes(1);
});
it('rejects stale confirmation and duplicate confirmation of a previous stage', async () => {
  const app = setup();app.controller.request(intent('first', true));
  await vi.waitFor(() => expect(app.controller.getState().phase).toBe('review'));
  const first = app.controller.getState();if (first.phase !== 'review') throw new Error('Review missing');
  expect(first.stage).toBe('structure');
  expect(app.controller.confirm(first.job, 'structure')).toBe(true);
  expect(app.controller.confirm(first.job, 'structure')).toBe(false);
  expect(app.controller.getState()).toMatchObject({ phase: 'review', stage: 'privacy' });
  app.controller.request(intent('second'));
  await vi.waitFor(() => expect(app.controller.getState()).toMatchObject({ phase: 'review', job: { id: 'second' } }));
  expect(app.controller.confirm(first.job, 'privacy')).toBe(false);
  expect(app.controller.cancelReview(first.job, 'privacy')).toBe(false);
  expect(app.render).not.toHaveBeenCalled();
  app.controller.cancel();
});
it('ignores policy completion after cancellation and releases the gesture lease exactly once', async () => {
  let finish!: (value: typeof policy) => void;const resolvePolicy = vi.fn(() => new Promise<typeof policy>(resolve => { finish = resolve; }));
  const release = vi.fn();const render = vi.fn();const gate = createExportGate();
  const controller = createExportController({ gate, resolvePolicy, openDelivery: () => ({ deliver: vi.fn(), release }), render });
  controller.request(intent());controller.cancel();finish(policy);
  await Promise.resolve();await Promise.resolve();
  expect(controller.getState()).toEqual({ phase: 'idle' });
  expect(release).toHaveBeenCalledTimes(1);
  expect(render).not.toHaveBeenCalled();
  const unlock = gate.acquire();expect(unlock).not.toBeNull();unlock?.();
});
it('keeps a failed policy read distinct and retries it against the captured request', async () => {
  const app = setup();const original = intent();
  app.resolvePolicy.mockResolvedValueOnce({ status: 'error', message: 'Policy offline' });
  app.controller.request(original);
  await vi.waitFor(() => expect(app.controller.getState().phase).toBe('error'));
  expect(app.captureResources).not.toHaveBeenCalled();
  app.controller.retry();
  await vi.waitFor(() => expect(app.controller.getState().phase).toBe('review'));
  expect(app.resolvePolicy).toHaveBeenLastCalledWith(true);
  expect(app.controller.getState()).toMatchObject({ phase: 'review', job: { source: original.captured.source } });
  app.controller.cancel();
});
it('cancels a queued execution before its handle is assigned', async () => {
  const app = setup();app.controller.request(intent());
  await vi.waitFor(() => expect(app.controller.getState().phase).toBe('review'));
  const review = app.controller.getState();if (review.phase !== 'review') throw new Error('Review missing');
  const unsubscribe = app.controller.subscribe(() => {
    const state = app.controller.getState();
    if (state.phase === 'executing' && state.execution.status === 'queued') app.controller.cancel();
  });
  app.controller.confirm(review.job, review.stage);
  await Promise.resolve();await Promise.resolve();
  expect(app.controller.getState()).toEqual({ phase: 'idle' });
  expect(app.render).not.toHaveBeenCalled();
  expect(app.deliver).not.toHaveBeenCalled();
  expect(app.release).toHaveBeenCalledTimes(2);
  const unlock = app.gate.acquire();expect(unlock).not.toBeNull();unlock?.();
  unsubscribe();
});
