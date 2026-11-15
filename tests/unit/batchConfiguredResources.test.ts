import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixtureInstance, fixturePage } from '../_helpers/formFixture';
import { prepareBatchSource } from '@/services/exports/batchSource';
import { idbReadAttachment } from '@/lib/documentsDb';
import { formTemplateAttachmentId } from '@/lib/formTemplateAssets';
import { useBatchStore, runBatchJob, recoverBatch } from '@/stores/batchStore';
import { collectLiveAttachmentIds } from '@/lib/attachmentGc';
import type { SerializedSession } from '@/stores/documentStore';

async function source(): Promise<{ session: SerializedSession; bytes: Uint8Array; sha256: string }> {
  const genericForm = fixtureInstance();genericForm.definition.rowGroups = {};
  const page = await fixturePage();genericForm.definition.pages[0].sha256 = page.sha256;
  return { ...page, session: { documentMode: 'compliant', documentCategory: 'forms', docType: 'standard_letter', formType: 'fixture', genericForm, formData: {}, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 123 } };
}

beforeEach(() => {
  useBatchStore.setState({ rows: [{ id: 'row', values: { name: 'Recipient B', decision: 'yes' }, status: 'pending' }], source: null, jobId: null, status: 'idle', stopRequested: false, recoveryError: '', sourcePreparationError: '' });
});
afterEach(() => { vi.restoreAllMocks();vi.unstubAllGlobals(); });

it('retains exact templates under existing digest ownership before row generation', async () => {
  const input = await source();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(input.bytes))));
  const generate = vi.fn(async (_values, context) => {
    const stored = await idbReadAttachment(formTemplateAttachmentId(input.sha256));
    expect(stored.status).toBe('found');
    if (stored.status === 'found') expect(new Uint8Array(stored.attachment.data)).toEqual(input.bytes);
    expect(context.source.genericForm.definition.definitionRevision).toBe('v1');
    return new Uint8Array([1]);
  });
  await runBatchJob({ source: input.session, title: 'Configured job', placeholders: ['name', 'decision'], generate, download: vi.fn() });
  expect(generate).toHaveBeenCalledOnce();
  input.session.genericForm!.definition.definitionRevision = 'replaced';
  expect(useBatchStore.getState().source?.genericForm?.definition.definitionRevision).toBe('v1');
  expect(await collectLiveAttachmentIds()).toContain(formTemplateAttachmentId(input.sha256));
  const recovered = recoverBatch(JSON.parse(JSON.stringify(useBatchStore.getState())));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Offline'); }));
  expect((await prepareBatchSource(recovered.source!, () => true)).genericForm?.definition.pages[0].sha256).toBe(input.sha256);
  expect(fetch).not.toHaveBeenCalled();
});

it('owns the definition before awaiting template loading', async () => {
  const input = await source();
  const prepared = prepareBatchSource(input.session, () => true);
  input.session.genericForm!.definition.label = 'New source';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(input.bytes))));
  expect((await prepared).genericForm?.definition.label).toBe('Fixture form');
});

it('rejects missing digests without generating and keeps failed rows available for retry', async () => {
  const input = await source();delete input.session.genericForm!.definition.pages[0].sha256;
  const generate = vi.fn();
  await runBatchJob({ source: input.session, title: 'Incomplete job', placeholders: ['name'], generate, download: vi.fn() });
  expect(generate).not.toHaveBeenCalled();
  expect(useBatchStore.getState().status).toBe('paused');
  expect(useBatchStore.getState().rows[0]).toMatchObject({ status: 'error' });
  expect(useBatchStore.getState().recoveryError).toContain('checksum');
});

it('does not publish a prepared source after ownership changes or cancellation', async () => {
  const input = await source();
  let current = true;
  const preparing = prepareBatchSource(input.session, () => current);
  current = false;
  await expect(preparing).rejects.toThrow('stopped');
});

it('abandons an old job if its source is replaced as asynchronous preparation completes', async () => {
  const input = await source();
  const resources = await import('@/services/exports/batchSource');
  let finish!: (value: SerializedSession) => void;
  vi.spyOn(resources, 'prepareBatchSource').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const generate = vi.fn();const download = vi.fn();
  const pending = runBatchJob({ source: input.session, title: 'Old job', placeholders: ['name'], generate, download });
  const replacement = { ...structuredClone(input.session), timestamp: 456 };
  const rows = [{ id: 'replacement', values: { name: 'Replacement' }, status: 'pending' as const }];
  useBatchStore.setState({ jobId: 'replacement-job', source: replacement, rows, status: 'paused', title: 'Replacement job',
    sourcePreparationError: 'Replacement preparation failed', recoveryError: 'Replacement storage warning' });
  finish(structuredClone(input.session));
  await pending;
  expect(generate).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
  expect(useBatchStore.getState()).toMatchObject({ jobId: 'replacement-job', source: replacement, rows, status: 'paused', title: 'Replacement job',
    sourcePreparationError: 'Replacement preparation failed', recoveryError: 'Replacement storage warning' });
});

it('does not deliver or change replacement rows when generation finishes late', async () => {
  const input = await source();
  input.session.documentCategory = 'correspondence';delete input.session.genericForm;
  let finish!: (value: Uint8Array) => void;
  const generate = vi.fn(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
  const download = vi.fn();
  const pending = runBatchJob({ source: input.session, title: 'Old job', placeholders: ['name'], generate, download });
  const replacement = structuredClone(input.session);
  const rows = [{ id: 'row', values: { name: 'Replacement' }, status: 'pending' as const }];
  useBatchStore.setState({ jobId: 'replacement-job', source: replacement, rows, status: 'paused' });
  finish(new Uint8Array([1]));await pending;
  expect(download).not.toHaveBeenCalled();
  expect(useBatchStore.getState()).toMatchObject({ jobId: 'replacement-job', rows, status: 'paused' });
});

it.each([false, true])('clears a recovered preparation error while preserving a newer independent warning (%s)', async newerWarning => {
  const input = await source();
  const preparationMessage = 'The portable form templates could not be retained.';
  const storageWarning = 'Generated files could not be retained in this browser. Keep the downloaded copies.';
  const resources = await import('@/services/exports/batchSource');
  vi.spyOn(resources, 'prepareBatchSource').mockRejectedValueOnce(new Error(preparationMessage));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(input.bytes))));
  const options = {
    source: input.session, title: 'Recoverable template', placeholders: ['name', 'decision'],
    generate: vi.fn(async () => input.bytes), download: vi.fn(),
  };
  await runBatchJob(options);
  expect(useBatchStore.getState()).toMatchObject({
    status: 'paused', recoveryError: preparationMessage, sourcePreparationError: preparationMessage,
  });
  const recovered = recoverBatch(JSON.parse(JSON.stringify(useBatchStore.getState())));
  useBatchStore.setState({ ...recovered, ...(newerWarning ? { recoveryError: storageWarning } : {}) });
  await runBatchJob({ ...options, retryFailed: true });
  expect(options.download).toHaveBeenCalledOnce();
  expect(useBatchStore.getState()).toMatchObject({
    status: 'complete', sourcePreparationError: '', recoveryError: newerWarning ? storageWarning : '',
  });
});

it('keeps the preparation diagnostic through a canceled retry until a current retry finishes', async () => {
  const input = await source();
  const message = 'Template page unavailable: page1.pdf';
  useBatchStore.setState({
    source: input.session, jobId: 'interrupted-preparation', status: 'paused',
    recoveryError: message, sourcePreparationError: message,
    rows: [{ id: 'row', values: { name: 'Recipient B', decision: 'yes' }, status: 'error', error: message }],
  });
  const resources = await import('@/services/exports/batchSource');
  let finish!: (value: SerializedSession) => void;
  vi.spyOn(resources, 'prepareBatchSource').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const options = {
    source: input.session, title: 'Recoverable template', placeholders: ['name', 'decision'], retryFailed: true,
    generate: vi.fn(async () => input.bytes), download: vi.fn(),
  };
  const pending = runBatchJob(options);
  useBatchStore.getState().stop();
  finish(structuredClone(input.session));
  await pending;
  expect(options.generate).not.toHaveBeenCalled();
  expect(useBatchStore.getState()).toMatchObject({ status: 'paused', recoveryError: message, sourcePreparationError: message });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(input.bytes))));
  await runBatchJob(options);
  expect(useBatchStore.getState()).toMatchObject({ status: 'complete', recoveryError: '', sourcePreparationError: '' });
});

it('defaults legacy preparation provenance and clears it when starting a new batch', () => {
  expect(recoverBatch({ recoveryError: 'Legacy warning' })).toMatchObject({
    recoveryError: 'Legacy warning', sourcePreparationError: '',
  });
  useBatchStore.setState({ status: 'paused', recoveryError: 'Old preparation failure', sourcePreparationError: 'Old preparation failure' });
  useBatchStore.getState().reset();
  expect(useBatchStore.getState()).toMatchObject({
    status: 'idle', source: null, recoveryError: '', sourcePreparationError: '',
  });
});
