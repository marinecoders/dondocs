import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { useBatchStore, runBatchJob, recoverBatch } from '@/stores/batchStore';
import { getSerializedSession } from '@/stores/documentStore';
import { getBatchOutput } from '@/lib/documentsDb';

beforeEach(() => {
  useBatchStore.setState({ rows: [1, 2, 3].map((id) => ({ id: String(id), values: { NAME: `Row ${id}` }, status: 'pending' })), source: null, status: 'idle', stopRequested: false, recoveryError: '' });
});

it('stops after the current file, resumes pending rows and retains completed downloads', async () => {
  const generate = vi.fn(async () => { useBatchStore.getState().stop(); return new Uint8Array([1, 2]); });
  const download = vi.fn();
  const options = { source: getSerializedSession(), title: 'Original source', placeholders: ['NAME'], generate, download };
  await runBatchJob(options);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(useBatchStore.getState().status).toBe('paused');
  const result = useBatchStore.getState().rows[0];
  expect(await getBatchOutput(result.outputId!)).toEqual(new Uint8Array([1, 2]));
  const resumed = vi.fn(async () => new Uint8Array([3]));
  await runBatchJob({ ...options, title: 'Changed source', generate: resumed });
  expect(resumed).toHaveBeenCalledTimes(2);
  expect(useBatchStore.getState().title).toBe('Original source');
  expect(useBatchStore.getState().status).toBe('complete');
  expect(download).toHaveBeenCalledTimes(3);
});

it('retries only failures and never repeats successful rows', async () => {
  const generate = vi.fn(async (values: Record<string, string>) => {
    if (values.NAME === 'Row 2') throw new Error('Test compilation failure');
    return new Uint8Array([1]);
  });
  const options = { source: getSerializedSession(), title: 'Job', placeholders: ['NAME'], generate, download: vi.fn() };
  await runBatchJob(options);
  const retry = vi.fn(async () => new Uint8Array([2]));
  await runBatchJob({ ...options, retryFailed: true, generate: retry });
  expect(retry).toHaveBeenCalledExactlyOnceWith({ NAME: 'Row 2' });
  expect(useBatchStore.getState().rows.every((r) => r.status === 'success')).toBe(true);
});

it('requires explicit retry for the uncertain row after reload', () => {
  const recovered = recoverBatch({ status: 'running', rows: [
    { id: '1', values: {}, status: 'success', outputId: 'retained' },
    { id: '2', values: {}, status: 'generating' },
    { id: '3', values: {}, status: 'pending' },
  ] });
  expect(recovered.status).toBe('interrupted');
  expect(recovered.rows?.map((r) => r.status)).toEqual(['success', 'error', 'pending']);
  expect(recovered.rows?.[1].error).toContain('Check your downloads');
});
