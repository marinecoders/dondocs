import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { XMLSerializer as XmlSerializer } from '@xmldom/xmldom';
import { installWordXmlDom } from '../_helpers/wordXmlDom';
import { wordImportFixture, wordParagraph } from '../_helpers/wordImportFixture';
import { useDocumentStore } from '@/stores/documentStore';
import { commitCurrentDocument, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { createExportGate } from '@/lib/exportController';
import { startReviewRound } from '@/lib/reviewRoundActions';
import { listReviewRounds, readReviewRound } from '@/lib/reviewRounds';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { createWordReviewExport } from '@/services/exports/wordReview';
import { readWordDocument } from '@/services/docx/import/readWord';
import { readWordReviewIdentity } from '@/services/docx/review/identity';
import { matchWordReviewHandoff } from '@/lib/wordReviewBaseline';
import type { CorrespondenceRendererPorts } from '@/services/exports/correspondence';
import type { ExportArtifact } from '@/lib/exportExecution';
installWordXmlDom();
const serializer = globalThis.XMLSerializer;
beforeAll(() => { globalThis.XMLSerializer = XmlSerializer as unknown as typeof XMLSerializer; });
afterAll(() => { globalThis.XMLSerializer = serializer; });
beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('subject', 'EXACT REVIEW');
  useDocumentStore.getState().updateParagraph(0, { text: 'Exact saved baseline body' });
});
afterEach(async () => { await flushDocumentWrites(); });
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
async function fixture() {
  await commitCurrentDocument();const round = await startReviewRound('Exact review');
  const bytes = await wordImportFixture(wordParagraph('1. Exact saved baseline body'));
  const gate = createExportGate(), release = vi.fn(), deliver = vi.fn<(artifact: ExportArtifact) => Promise<boolean>>(async () => true);
  const convertDocx = vi.fn<CorrespondenceRendererPorts['convertDocx']>(async () => new Blob([new Uint8Array(bytes)]));
  const resolvePolicy = vi.fn(async () => policy);
  const owner = createWordReviewExport({ gate, resolvePolicy, renderer: { convertDocx, compile: vi.fn() }, openDelivery: () => ({ deliver, release }) });
  return { owner, gate, round, bytes, deliver, release, convertDocx, resolvePolicy };
}
async function finish(app: Awaited<ReturnType<typeof fixture>>, phase = 'success') {
  await vi.waitFor(() => {
    const state = app.owner.controller.getState();
    if (state.phase === 'review') app.owner.controller.confirm(state.job, state.stage);
    expect(app.owner.controller.getState().phase).toBe(phase);
  });
}
function free(app: Awaited<ReturnType<typeof fixture>>) { const release = app.gate.acquire();expect(release).not.toBeNull();release?.(); }

describe('owned Word review export', () => {
  it('stops a saved window-envelope review before asking for export approval or rendering', async () => {
    useDocumentStore.getState().setField('windowEnvelope', 'standard');
    const app = await fixture();
    useDocumentStore.getState().setField('windowEnvelope', undefined);
    expect(() => app.owner.request(app.round)).toThrow('Word review returns do not support window-envelope opening fields');
    expect(app.owner.controller.getState().phase).toBe('idle');
    expect(app.convertDocx).not.toHaveBeenCalled();
    expect((await readReviewRound(app.round.id))?.wordHandoffs).toBeUndefined();
    free(app);
    app.owner.dispose();
  });
  it('exports and locally retains exactly the saved baseline despite newer pre-existing editor work', async () => {
    const app = await fixture();useDocumentStore.getState().updateParagraph(0, { text: 'Newer current draft work' });
    expect(app.owner.request(app.round)).toBe(true);await finish(app);
    const artifact = app.deliver.mock.calls[0][0], bytes = new Uint8Array(await artifact.blob.arrayBuffer());
    const identity = await readWordReviewIdentity(bytes), imported = await readWordDocument(bytes, artifact.job.filename), saved = await readReviewRound(app.round.id);
    expect((await matchWordReviewHandoff(saved!, identity, imported, app.round.ownerDocumentId!))[0].expected).toBe('Exact saved baseline body');
    expect(saved?.wordHandoffs?.[0].docxSha256).toBe(imported.source.sha256);
    expect(app.convertDocx.mock.calls[0][0]).toContain('Exact saved baseline body');
    expect(useDocumentStore.getState().paragraphs[0].text).toBe('Newer current draft work');free(app);app.owner.dispose();
  });
  it('does not start while another export owns the shared gate', async () => {
    const app = await fixture(), release = app.gate.acquire()!;
    expect(app.owner.request(app.round)).toBe(false);expect(app.convertDocx).not.toHaveBeenCalled();release();app.owner.dispose();
  });
  it.each(['cancel', 'owner-change'] as const)('suppresses a late worker result before receipt and delivery: %s', async mode => {
    const app = await fixture();let resume!: () => void;
    app.convertDocx.mockImplementationOnce(async () => { await new Promise<void>(resolve => { resume = resolve; });return new Blob([new Uint8Array(app.bytes)]); });
    app.owner.request(app.round);await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
    if (mode === 'cancel') expect(app.owner.controller.cancel()).toBe(true);else useDocumentsStore.getState().newDocument();
    resume();await finish(app, mode === 'cancel' ? 'idle' : 'error');
    expect((await readReviewRound(app.round.id))?.wordHandoffs).toBeUndefined();expect(app.deliver).not.toHaveBeenCalled();free(app);app.owner.dispose();
  });
  it('retains an undelivered receipt without claiming success or retrying old bytes', async () => {
    const app = await fixture();app.deliver.mockResolvedValueOnce(false);
    app.owner.request(app.round);await finish(app, 'error');
    expect((await readReviewRound(app.round.id))?.wordHandoffs).toHaveLength(1);free(app);
    app.owner.controller.retry();await finish(app);
    expect(app.convertDocx).toHaveBeenCalledTimes(2);expect(app.deliver).toHaveBeenCalledTimes(2);
    const first = await readWordReviewIdentity(new Uint8Array(await app.deliver.mock.calls[0][0].blob.arrayBuffer()));
    const second = await readWordReviewIdentity(new Uint8Array(await app.deliver.mock.calls[1][0].blob.arrayBuffer()));
    expect(first.locator.handoffId).not.toBe(second.locator.handoffId);
    expect((await readReviewRound(app.round.id))?.wordHandoffs).toHaveLength(2);free(app);app.owner.dispose();
  });
  it.each(['cancel', 'owner-change'] as const)('suppresses delivery after receipt retention: %s', async mode => {
    const app = await fixture(), owner = createWordReviewExport({ gate: app.gate, resolvePolicy: app.resolvePolicy,
      renderer: { convertDocx: app.convertDocx, compile: vi.fn() }, openDelivery: () => ({ deliver: app.deliver, release: app.release }),
      onSaved: () => { if (mode === 'cancel') owner.controller.cancel();else useDocumentsStore.getState().newDocument(); } });
    owner.request(app.round);await vi.waitFor(() => expect(owner.controller.getState().phase).toBe(mode === 'cancel' ? 'idle' : 'error'));
    expect((await readReviewRound(app.round.id))?.wordHandoffs).toHaveLength(1);expect(app.deliver).not.toHaveBeenCalled();
    await Promise.resolve();expect(app.deliver).not.toHaveBeenCalled();free(app);owner.dispose();app.owner.dispose();
  });
  it('checks the original generated Word metadata before retaining or delivering the copy', async () => {
    const app = await fixture(), bytes = await wordImportFixture(wordParagraph('1. Exact saved baseline body'), {
      'docProps/core.xml': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>SECRET</dc:title></cp:coreProperties>' });
    app.convertDocx.mockResolvedValueOnce(new Blob([new Uint8Array(bytes)]));app.owner.request(app.round);await finish(app, 'error');
    expect(app.deliver).not.toHaveBeenCalled();expect((await readReviewRound(app.round.id))?.wordHandoffs).toBeUndefined();free(app);app.owner.dispose();
  });
  it('blocks changed policy before saving a locator', async () => {
    const app = await fixture();app.resolvePolicy.mockResolvedValueOnce(policy).mockResolvedValueOnce(resolveExportDeploymentPolicy({ hostname: 'changed.test', environment: null, runtime: { status: 'absent' } }));
    app.owner.request(app.round);await finish(app, 'error');expect(app.deliver).not.toHaveBeenCalled();
    expect((await listReviewRounds()).find(round => round.id === app.round.id)?.wordHandoffs).toBeUndefined();free(app);app.owner.dispose();
  });
});
