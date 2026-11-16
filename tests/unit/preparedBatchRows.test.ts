import { expect, it, vi } from 'vitest';
import { prepareBatchRow, renderPreparedBatchRow, type BatchRowContext } from '@/services/exports/batchRows';
import { acknowledgePreparedExport, copyPreparedDocument, copyExportReview } from '@/lib/preparedExport';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { CLASSIFICATION_LEVELS } from '@/lib/overallClassification';
import { inspectSavedBatchResult } from '@/services/exports/batchResultsZip';
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

it('maps typed configured answers before review, keeps source answers separate and dispatches the PDF renderer', async () => {
  const { fixtureInstance, fixturePage } = await import('../_helpers/formFixture');
  const { captureFormExportTemplates } = await import('@/lib/formExportTemplates');
  const { PDFDocument } = await import('pdf-lib');
  const form = fixtureInstance();form.definition.rowGroups = {};
  const page = await fixturePage();form.definition.pages[0].sha256 = page.sha256;
  const row: BatchRowContext = { ...context(), source: { ...context().source, documentCategory: 'forms', formType: 'fixture', genericForm: form } };
  const result = await prepareBatchRow({ name: '000456', decision: 'No', a: 'false' }, row, {
    resolvePolicy: async () => policy,
    captureResources: async () => captureFormExportTemplates('configured-form', 'fixture', { 'page1.pdf': page.bytes }, JSON.stringify(form.definition)),
  });
  if ('issues' in result) throw new Error(result.issues.join('\n'));
  const ready = result.status === 'ready' ? result.job : acknowledgePreparedExport(result.job);
  const captured = copyPreparedDocument(ready);
  expect(captured.document.genericForm?.answers).toEqual({ name: '000456', decision: 'no', a: false });
  expect(form.answers.name).toBe('000123');
  const compile = vi.fn();
  const artifact = await renderPreparedBatchRow(ready, { compile, convertDocx: vi.fn(), waitForReady: vi.fn() }, new AbortController().signal);
  const output = await PDFDocument.load(await artifact.blob.arrayBuffer());
  expect(output.getPageCount()).toBe(1);
  expect(compile).not.toHaveBeenCalled();
});

it('refuses invalid configured answers before consulting deployment policy', async () => {
  const { fixtureInstance } = await import('../_helpers/formFixture');
  const form = fixtureInstance();form.definition.rowGroups = {};
  const resolvePolicy = vi.fn();
  await expect(prepareBatchRow({ name: '', decision: 'invalid' }, { ...context(), source: { ...context().source, documentCategory: 'forms', formType: 'fixture', genericForm: form } }, { resolvePolicy, captureResources: vi.fn() })).rejects.toThrow('Name is required');
  expect(resolvePolicy).not.toHaveBeenCalled();
});

it('captures multiple selections and reviews their resolved labels before export and retained download', async () => {
  const { fixtureInstance, fixturePage } = await import('../_helpers/formFixture');
  const { captureFormExportTemplates } = await import('@/lib/formExportTemplates');
  const form = fixtureInstance();form.definition.rowGroups = {};
  form.definition.fields.decision.kind = 'multipleChoice';
  form.definition.fields.decision.options![0].label = 'SSN 123-45-6789';
  form.answers.decision = ['no'];
  const page = await fixturePage();form.definition.pages[0].sha256 = page.sha256;
  const source = { ...context().source, documentCategory: 'forms' as const, formType: 'fixture', genericForm: form };
  const values = { name: 'Recipient B', decision: '["yes"]' };
  const result = await prepareBatchRow(values, { ...context(), source }, {
    resolvePolicy: async () => policy,
    captureResources: async () => captureFormExportTemplates('configured-form', 'fixture', { 'page1.pdf': page.bytes }, JSON.stringify(form.definition)),
  });
  if (result.status !== 'needs-review') throw new Error(JSON.stringify(result));
  expect(copyExportReview(result.job).privacy.findings.some(finding => finding.value === '123-45-6789')).toBe(true);
  expect(copyPreparedDocument(acknowledgePreparedExport(result.job)).document.genericForm?.answers.decision).toEqual(['yes']);
  expect(form.answers.decision).toEqual(['no']);
  expect(inspectSavedBatchResult({ id: 'row', values, filename: 'saved.pdf', outputId: 'output', status: 'success' }, source, 'batch').findings.some(finding => finding.value === '123-45-6789')).toBe(true);
});

it('preserves literal configured text while reviewing raw roster values on generation and saved downloads', async () => {
  const { fixtureInstance, fixturePage } = await import('../_helpers/formFixture');
  const { captureFormExportTemplates } = await import('@/lib/formExportTemplates');
  const form = fixtureInstance();
  form.definition.rowGroups = {};
  form.definition.fields.name.kind = 'text';
  form.definition.fields.decision.options![0].label = 'SSN 123-45-6789';
  const page = await fixturePage();
  form.definition.pages[0].sha256 = page.sha256;
  const source = { ...context().source, documentCategory: 'forms' as const, formType: 'fixture', genericForm: form };
  const values = { name: 'Keep literal {{decision}}', decision: 'SSN 123-45-6789' };
  const result = await prepareBatchRow(values, { ...context(), source }, {
    resolvePolicy: async () => policy,
    captureResources: async () => captureFormExportTemplates('configured-form', 'fixture', { 'page1.pdf': page.bytes }, JSON.stringify(form.definition)),
  });
  if (result.status !== 'needs-review') throw new Error(JSON.stringify(result));
  expect(copyExportReview(result.job).privacy.findings.some(finding => finding.value === '123-45-6789')).toBe(true);
  const ready = acknowledgePreparedExport(result.job);
  expect(copyPreparedDocument(ready).document.genericForm?.answers)
    .toEqual({ name: 'Keep literal {{decision}}', decision: 'yes' });
  const savedReview = inspectSavedBatchResult({ id: 'row', values, filename: 'saved.pdf', outputId: 'output', status: 'success' }, source, 'batch');
  expect(savedReview.findings.some(finding => finding.value === '123-45-6789')).toBe(true);
});

it('captures and reviews repeated typed rows, renders their pinned PDF, and refuses overflow before policy', async () => {
  const { fixtureInstance, fixturePage } = await import('../_helpers/formFixture');
  const { captureFormExportTemplates } = await import('@/lib/formExportTemplates');
  const { PDFDocument } = await import('pdf-lib');
  const form = fixtureInstance();
  form.rows.roster = [{ id: 'source-only', answers: { grade: 'e1', date: '2020-01-01' } }];
  form.definition.rowGroups.roster.columns.grade.options![1].label = 'SSN 123-45-6789';
  const page = await fixturePage();form.definition.pages[0].sha256 = page.sha256;
  const source = { ...context().source, documentCategory: 'forms' as const, formType: 'fixture', genericForm: form };
  const values = { name: 'Recipient B', decision: 'yes', roster: '[{"grade":"e2","date":"2026-02-28"},{"grade":"e1"}]' };
  const result = await prepareBatchRow(values, { ...context(), source }, {
    resolvePolicy: async () => policy,
    captureResources: async () => captureFormExportTemplates('configured-form', 'fixture', { 'page1.pdf': page.bytes }, JSON.stringify(form.definition)),
  });
  if (result.status !== 'needs-review') throw new Error(JSON.stringify(result));
  expect(copyExportReview(result.job).privacy.findings.some(finding => finding.value === '123-45-6789')).toBe(true);
  const ready = acknowledgePreparedExport(result.job);
  expect(copyPreparedDocument(ready).document.genericForm?.rows.roster).toEqual([
    { id: 'batch_roster_0', answers: { grade: 'e2', date: '2026-02-28' } },
    { id: 'batch_roster_1', answers: { grade: 'e1' } },
  ]);
  const artifact = await renderPreparedBatchRow(ready, { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: vi.fn() }, new AbortController().signal);
  expect((await PDFDocument.load(await artifact.blob.arrayBuffer())).getPageCount()).toBe(1);
  expect(form.rows.roster).toEqual([{ id: 'source-only', answers: { grade: 'e1', date: '2020-01-01' } }]);
  expect(inspectSavedBatchResult({ id: 'row', values, filename: 'rows.pdf', outputId: 'output', status: 'success' }, source, 'batch').findings.some(finding => finding.value === '123-45-6789')).toBe(true);
  const resolvePolicy = vi.fn();
  await expect(prepareBatchRow({ ...values, roster: JSON.stringify(Array(4).fill({ grade: 'e1' })) }, { ...context(), source }, { resolvePolicy, captureResources: vi.fn() })).rejects.toThrow('at most 3 roster rows');
  expect(resolvePolicy).not.toHaveBeenCalled();
});
