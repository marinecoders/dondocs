import { expect, it, vi } from 'vitest';
import { executePreparedExport, createExportArtifact, type ExportExecutionPorts } from '@/lib/exportExecution';
import { prepareExport, type ReadyExportJob } from '@/lib/preparedExport';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

function job(id = 'one'): ReadyExportJob {
  const captured = captureDocumentRevision({ documentId: id, epoch: 1, editSequence: 1, capturedAt: 1 }, { documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter', formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {} });
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  const result = prepareExport({ id, captured, filename: `${id}.pdf`, target: 'pdf', policy });
  if (result.status !== 'ready') throw new Error('Expected ready job');
  return result.job;
}
const artifact = (ready: ReadyExportJob) => createExportArtifact(ready, new Blob(['PDF'], { type: 'application/pdf' }));
function ports(): ExportExecutionPorts {
  return { render: vi.fn(async ready => artifact(ready)), deliver: vi.fn(async () => true), release: vi.fn(), onState: vi.fn() };
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

it('cancels queued work without entering a renderer and releases once', async () => {
  const adapters = ports();
  const execution = executePreparedExport(job(), adapters);
  expect(execution.cancel()).toBe(true);
  expect(await execution.result).toMatchObject({ status: 'cancelled' });
  expect(adapters.render).not.toHaveBeenCalled();
  expect(adapters.deliver).not.toHaveBeenCalled();
  expect(adapters.release).toHaveBeenCalledTimes(1);
  expect(execution.cancel()).toBe(false);
});
it('waits for a running worker before releasing resources or resolving cancellation', async () => {
  const ready = job();const worker = pending<ReturnType<typeof artifact>>();
  const adapters = ports();adapters.render = vi.fn(() => worker.promise);
  const execution = executePreparedExport(ready, adapters);
  await Promise.resolve();
  execution.cancel();
  expect(execution.getState()).toMatchObject({ status: 'running', cancellationRequested: true });
  expect(adapters.release).not.toHaveBeenCalled();
  let finished = false;void execution.result.then(() => { finished = true; });
  await Promise.resolve();expect(finished).toBe(false);
  worker.resolve(artifact(ready));
  expect(await execution.result).toMatchObject({ status: 'cancelled' });
  expect(adapters.deliver).not.toHaveBeenCalled();
  expect(adapters.release).toHaveBeenCalledTimes(1);
});
it('settles every waiter after renderer failure and preserves the original failure through cleanup', async () => {
  const adapters = ports();adapters.render = vi.fn(async () => { throw new Error('Engine failed'); });
  adapters.release = vi.fn(() => { throw new Error('Cleanup failed'); });
  const execution = executePreparedExport(job(), adapters);
  const results = await Promise.all([execution.result, execution.result]);
  expect(results[0]).toBe(results[1]);
  expect(results[0]).toEqual({ status: 'failed', message: 'Engine failed', cleanupIssues: ['Cleanup failed'] });
  expect(adapters.deliver).not.toHaveBeenCalled();
});
it('refuses mismatched or incomplete artifacts', async () => {
  const other = job('other');const adapters = ports();adapters.render = vi.fn(async () => artifact(other));
  expect(await executePreparedExport(job(), adapters).result).toMatchObject({ status: 'failed', message: expect.stringContaining('does not belong') });
  adapters.render = vi.fn(async ready => createExportArtifact(ready, new Blob(['partial']), [{ message: 'Enclosure missing' }]));
  expect(await executePreparedExport(job(), adapters).result).toMatchObject({ status: 'failed', message: 'Enclosure missing' });
  expect(adapters.deliver).not.toHaveBeenCalled();
});
it('treats delivery as a handoff and retains success when subsequent cleanup fails', async () => {
  const delivery = pending<boolean>();const adapters = ports();adapters.deliver = vi.fn(() => delivery.promise);
  adapters.release = vi.fn(() => { throw new Error('Release warning'); });
  const execution = executePreparedExport(job(), adapters);
  await Promise.resolve();await Promise.resolve();
  expect(execution.getState()).toMatchObject({ status: 'running', phase: 'delivering' });
  expect(execution.cancel()).toBe(false);
  delivery.resolve(true);
  expect(await execution.result).toMatchObject({ status: 'succeeded', cleanupIssues: ['Release warning'] });
  expect(adapters.release).toHaveBeenCalledTimes(1);
});
it('retries the same issued job and isolates observers from execution', async () => {
  const ready = job();const adapters = ports();
  adapters.deliver = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  adapters.onState = () => { throw new Error('Observer failed'); };
  expect(await executePreparedExport(ready, adapters).result).toMatchObject({ status: 'failed' });
  const retry = executePreparedExport(ready, adapters);
  expect(await retry.result).toMatchObject({ status: 'succeeded' });
  expect(adapters.render).toHaveBeenNthCalledWith(2, ready, expect.any(AbortSignal));
  expect(retry.job.filename).toBe('one.pdf');
  expect(() => Object.assign(retry.getState(), { status: 'queued' })).toThrow();
});

it('captures adapter functions before observers or later code can replace them', async () => {
  const adapters = ports();const originalDelivery = adapters.deliver;
  const execution = executePreparedExport(job(), adapters);
  adapters.deliver = vi.fn(async () => false);
  expect(await execution.result).toMatchObject({ status: 'succeeded' });
  expect(originalDelivery).toHaveBeenCalledTimes(1);
  expect(adapters.deliver).not.toHaveBeenCalled();
});

it('publishes cancellation once and avoids entering the renderer when an observer cancels', async () => {
  const adapters = ports();
  let notifications = 0;
  adapters.onState = state => { notifications++; if (state.status === 'running' && notifications < 10) execution.cancel(); };
  const execution = executePreparedExport(job(), adapters);
  expect(await execution.result).toMatchObject({ status: 'cancelled' });
  expect(notifications).toBe(4); // queued, rendering, cancellation requested, cancelled
  expect(adapters.render).not.toHaveBeenCalled();
  expect(adapters.release).toHaveBeenCalledTimes(1);
});
it('isolates rejected async observers from execution and the unhandled rejection channel', async () => {
  const unhandled: unknown[] = [];
  const record = (error: unknown) => { unhandled.push(error); };
  process.on('unhandledRejection', record);
  try {
    const adapters = ports(); adapters.onState = async () => { throw new Error('Async observer failed'); };
    expect(await executePreparedExport(job(), adapters).result).toMatchObject({ status: 'succeeded' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(unhandled).toEqual([]);
  } finally { process.off('unhandledRejection', record); }
});
it.each(['render', 'release'] as const)('settles every waiter when %s rejects with a value that cannot be stringified', async stage => {
  const adapters = ports();
  if (stage === 'render') adapters.render = async () => { throw Object.create(null); };
  else adapters.release = async () => { throw Object.create(null); };
  const execution = executePreparedExport(job(), adapters);
  const [first, second] = await Promise.all([execution.result, execution.result]);
  expect(first).toBe(second);
  expect(first.status).toBe(stage === 'render' ? 'failed' : 'succeeded');
  expect(execution.getState()).toBe(first);
  if (stage === 'render') expect(first).toMatchObject({ message: 'The export failed.' });
  else expect(first.cleanupIssues).toEqual(['The export failed.']);
});

it('settles a renderer failure even when its compiler diagnostics getter throws', async () => {
  const error = Object.defineProperty(new Error('Engine failed'), 'compileLog', { get() { throw new Error('Diagnostics unavailable'); } });
  const adapters = ports(); adapters.render = async () => { throw error; };
  const execution = executePreparedExport(job(), adapters);
  expect(await execution.result).toMatchObject({ status: 'failed', message: 'Engine failed' });
  expect(execution.getState().status).toBe('failed');
  expect(adapters.release).toHaveBeenCalledTimes(1);
});
