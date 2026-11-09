import { expect, it, vi } from 'vitest';
import { prepareBatchRow, renderPreparedBatchRow, type BatchRowContext } from '@/services/exports/batchRows';
import { acknowledgePreparedExport, copyPreparedDocument, copyExportReview } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'top_secret_sci', allowedLevels: [...CLASSIFICATION_LEVELS] }, runtime: { status: 'absent' } });
const context = (): BatchRowContext => ({ batchId: 'batch-a', rowId: 'row-a', filename: 'original.pdf', capturedAt: 1, source: {
  timestamp: 1, documentMode: 'custom', documentCategory: 'correspondence', docType: 'standard_letter', formType: 'navmc_10274',
  formData: { subject: '{{NAME}}', classLevel: 'cui' }, paragraphs: [{ text: '{{BODY}}', level: 0, portionMarking: 'S' }], references: [], enclosures: [], copyTos: [], distributions: [],
} });
it('owns each row before asynchronous policy reads and reviews substituted output', async () => {
  const input = { ...context() };const values = { NAME: 'Original', BODY: 'SSN 123-45-6789' };
  let resolve!: (value: typeof policy) => void;
  const pending = prepareBatchRow(values, input, { resolvePolicy: () => new Promise(done => { resolve = done; }), captureResources: async () => undefined });
  input.source.formData.subject = 'Changed';input.filename = 'changed.pdf';values.NAME = 'Changed';values.BODY = 'Different';resolve(policy);
  const result = await pending;if (result.status !== 'needs-review') throw new Error(JSON.stringify(result));
  expect(copyExportReview(result.job).privacy.findings.some(f => f.value === '123-45-6789')).toBe(true);
  const ready = acknowledgePreparedExport(result.job);expect(ready.job.filename).toBe('original.pdf');
  expect(copyPreparedDocument(ready).document.formData).toMatchObject({ subject: 'Original', classLevel: 'secret' });
});
it('uses the same prepared row on engine recovery without repeating policy or substitution', async () => {
  const input = context();const resolvePolicy = vi.fn(async () => policy);
  const result = await prepareBatchRow({ NAME: 'Original', BODY: 'Body' }, input, { resolvePolicy, captureResources: async () => undefined });
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  const compile = vi.fn().mockRejectedValueOnce(new Error('ENGINE_RESET_NEEDED')).mockResolvedValueOnce(new Uint8Array([37, 80, 68, 70]));
  await renderPreparedBatchRow(result.job, { compile, convertDocx: vi.fn(), waitForReady: vi.fn(async () => true) }, new AbortController().signal);
  expect(compile).toHaveBeenCalledTimes(2);expect(compile.mock.calls[0][0]).toEqual(compile.mock.calls[1][0]);expect(resolvePolicy).toHaveBeenCalledTimes(1);
});
