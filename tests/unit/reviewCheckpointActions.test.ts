import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { startReviewRound, transitionReviewRound, buildReviewCopy, parseReviewCopy } from '@/lib/reviewRoundActions';
import { saveReviewCheckpoint, importReviewCheckpoint } from '@/lib/reviewCheckpointActions';
import { idbSaveReviewCheckpoint } from '@/lib/documentsDb';
import { createReviewCheckpoint } from '@/lib/reviewCheckpoints';
import { readReviewRound } from '@/lib/reviewRounds';
import { buildBackup } from '@/lib/backup';

vi.mock('@/lib/encoding', async original => ({
  ...await original<typeof import('@/lib/encoding')>(), triggerDownload: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'FICTIONAL CHECKPOINT SOURCE');
});
afterEach(async () => {
  await flushDocumentWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('saves independent reviewer markers, updates only the selected marker, and retains them in transfers', async () => {
  const round = await startReviewRound('Checkpoint source');
  const first = { id: crypto.randomUUID(), label: 'Example chief' };
  const second = { id: crypto.randomUUID(), label: 'Example chief' };
  await saveReviewCheckpoint(round.id, first);
  const both = await saveReviewCheckpoint(round.id, second);
  expect(both.checkpoints).toHaveLength(2);
  const secondCheckpoint = both.checkpoints!.find(item => item.reviewerId === second.id)!;
  useDocumentStore.getState().setField('to', 'Newer recipient');
  const updated = await saveReviewCheckpoint(round.id, first);
  expect(updated.checkpoints).toHaveLength(2);
  expect(updated.checkpoints?.find(item => item.reviewerId === second.id)).toEqual(secondCheckpoint);
  const copy = await buildReviewCopy(updated);
  expect((await parseReviewCopy(copy)).envelope.round.checkpoints).toEqual(updated.checkpoints);
  const backup = JSON.parse(await buildBackup());
  expect(backup.reviewRounds.find((item: { id: string }) => item.id === round.id).checkpoints).toEqual(updated.checkpoints);
});

it('imports a valid marker idempotently without changing document text or decisions', async () => {
  const round = await startReviewRound('Portable checkpoint');
  const saved = await saveReviewCheckpoint(round.id, { id: crypto.randomUUID(), label: 'Example reviewer' });
  const checkpoint = saved.checkpoints![0];
  useDocumentStore.getState().setField('to', 'Current recipient');
  await importReviewCheckpoint(JSON.parse(JSON.stringify(checkpoint)));
  const again = await importReviewCheckpoint(checkpoint);
  expect(again.checkpoints).toHaveLength(1);
  expect(useDocumentStore.getState().formData.to).toBe('Current recipient');
  expect(again.baseline).toEqual(round.baseline);
});

it('rejects stale writes after lifecycle changes and cannot use a marker to create ownership', async () => {
  const round = await startReviewRound('Lifecycle fence');
  const checkpoint = await createReviewCheckpoint(round, round.baseline.session, null, { id: crypto.randomUUID(), label: 'Example reviewer' });
  const closed = await transitionReviewRound(round, 'close');
  expect(await idbSaveReviewCheckpoint(round, checkpoint, round.ownerDocumentId!, () => true)).toBeNull();
  expect(await idbSaveReviewCheckpoint(closed, checkpoint, 'another-document', () => true)).toBeNull();
  expect((await readReviewRound(round.id))?.lifecycle).toEqual(closed.lifecycle);
  expect((await readReviewRound(round.id))?.checkpoints).toBeUndefined();
});

it('keeps a delayed import from another activation and rejects corrupted checkpoint text', async () => {
  const round = await startReviewRound('Import guard');
  const saved = await saveReviewCheckpoint(round.id, { id: crypto.randomUUID(), label: 'Example reviewer' });
  const checkpoint = saved.checkpoints![0];
  const target = captureDocumentTarget();
  useDocumentStore.getState().setField('to', 'Newer work');
  await expect(importReviewCheckpoint(checkpoint, target)).rejects.toThrow(/draft changed/);
  const wrong = structuredClone(checkpoint);
  wrong.reviewerLabel = 'Modified after capture';
  await expect(importReviewCheckpoint(wrong)).rejects.toThrow(/checksum/);
  expect(useDocumentStore.getState().formData.to).toBe('Newer work');
});

it('includes earlier checkpoint text in the reviewer-copy privacy review', async () => {
  const { prepareReviewCopyExport } = await import('@/lib/reviewRoundActions');
  const { resolveExportDeploymentPolicy } = await import('@/lib/exportDeploymentPolicy');
  const round = await startReviewRound('Earlier retained checkpoint text');
  useDocumentStore.getState().setField('to', 'Fictional SSN 123-45-6789');
  const saved = await saveReviewCheckpoint(round.id, { id: crypto.randomUUID(), label: 'Example chief' });
  useDocumentStore.getState().setField('to', 'Current recipient');
  const envelope = await buildReviewCopy(saved);
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  expect(prepareReviewCopyExport(envelope, policy).review.privacy.found).toBe(true);
  expect(JSON.stringify(envelope.draft)).not.toContain('123-45-6789');
});

it('blocks reviewer-copy delivery when a retained checkpoint was captured at a higher marking than its baseline', async () => {
  const { prepareReviewCopyExport } = await import('@/lib/reviewRoundActions');
  const { resolveExportDeploymentPolicy } = await import('@/lib/exportDeploymentPolicy');
  const round = await startReviewRound('Unclassified baseline');
  useDocumentStore.getState().setField('classLevel', 'secret');
  const saved = await saveReviewCheckpoint(round.id, { id: crypto.randomUUID(), label: 'Example chief' });
  const envelope = await buildReviewCopy(saved);
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  expect(() => prepareReviewCopyExport(envelope, policy)).toThrow(/configured levels/);
});

it('rechecks a stricter delivery policy for already prepared checkpoint and reviewer-copy files', async () => {
  const { downloadReviewCheckpoint, prepareCheckpointExport } = await import('@/lib/reviewCheckpointActions');
  const { downloadReviewCopy, prepareReviewCopyExport } = await import('@/lib/reviewRoundActions');
  const { triggerDownload } = await import('@/lib/encoding');
  const { resolveExportDeploymentPolicy } = await import('@/lib/exportDeploymentPolicy');
  const allowed = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: {
    maxLevel: 'secret', allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'],
  }, runtime: { status: 'absent' } });
  const restricted = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  const round = await startReviewRound('Fresh download policy');
  useDocumentStore.getState().setField('classLevel', 'secret');
  const saved = await saveReviewCheckpoint(round.id, { id: crypto.randomUUID(), label: 'Example chief' });
  const checkpoint = await prepareCheckpointExport(saved.checkpoints![0], saved, allowed);
  const copy = prepareReviewCopyExport(await buildReviewCopy(saved), allowed);
  expect(checkpoint.review.marking).toBe('SECRET');
  expect(copy.review.marking).toBe('SECRET');
  expect(() => downloadReviewCheckpoint(checkpoint, restricted)).toThrow(/configured levels/);
  expect(() => downloadReviewCopy(copy, restricted)).toThrow(/configured levels/);
  expect(triggerDownload).not.toHaveBeenCalled();
  downloadReviewCheckpoint(checkpoint, allowed);
  downloadReviewCopy(copy, allowed);
  expect(triggerDownload).toHaveBeenCalledTimes(2);
});
