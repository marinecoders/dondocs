import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { useDocumentsStore, flushDocumentWrites } from '@/stores/documentsStore';
import { startReviewRound, buildReviewCopy, parseReviewCopy, openReviewCopy, prepareReviewCopyExport } from '@/lib/reviewRoundActions';
import { saveReviewCheckpoint, prepareCheckpointExport } from '@/lib/reviewCheckpointActions';
import { createReviewCheckpoint } from '@/lib/reviewCheckpoints';
import { reviewPayloadDigest, readReviewRound } from '@/lib/reviewRounds';
import { idbDeleteReviewRound, idbSaveReviewCheckpoint } from '@/lib/documentsDb';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { buildBackup, restoreBackup } from '@/lib/backup';

const restricted = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setFormData({ subject: 'INDEPENDENT SYNTHETIC CHECKPOINT', classLevel: 'unclassified', customClassification: '' });
});
afterEach(async () => {
  await flushDocumentWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(['top_secret_sci', 'paragraph-TS', 'figure-S', 'custom-SCI'] as const)('keeps the %s floor when marking metadata and readable labels are removed', async marking => {
  const round = await startReviewRound('Canonical document floor');
  const source = getSerializedSession();
  if (marking === 'top_secret_sci') source.formData.classLevel = 'top_secret_sci';
  if (marking === 'paragraph-TS') source.paragraphs = [{ id: 'classified-paragraph', text: 'Synthetic retained text', level: 0, portionMarking: 'TS' }];
  if (marking === 'figure-S') source.paragraphs = [{ id: 'classified-figure', text: 'Synthetic caption', level: 0, figure: { name: 'synthetic.png', portionMarking: 'S' } }];
  if (marking === 'custom-SCI') {
    source.formData.classLevel = 'custom';
    source.formData.customClassification = 'TOP SECRET//SCI';
  }
  const checkpoint = await createReviewCheckpoint(round, source, null, { id: crypto.randomUUID(), label: 'Synthetic reviewer' });
  const { digest: _digest, ...content } = checkpoint;
  content.markings = [];
  content.document = content.document.map(field => ({ ...field, label: 'Ordinary retained field' }));
  const reencoded = { ...content, digest: await reviewPayloadDigest(content) };
  await expect(prepareCheckpointExport(reencoded, round, restricted)).rejects.toThrow(/configured levels/);
});

it('retains higher checkpoint context after a fresh reviewer-copy import and workspace restore', async () => {
  const round = await startReviewRound('Unclassified baseline with higher later observation');
  useDocumentStore.getState().setField('classLevel', 'secret');
  const saved = await saveReviewCheckpoint(round.id, { id: crypto.randomUUID(), label: 'Synthetic chief' });
  useDocumentStore.getState().setField('classLevel', 'unclassified');
  const copy = await parseReviewCopy(await buildReviewCopy(saved));
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(copy)).toBe('applied');
  const received = (await readReviewRound(round.id))!;
  expect(received.ownerDocumentId).toBeUndefined();
  expect(received.checkpoints).toEqual(saved.checkpoints);
  const rebuilt = await buildReviewCopy(received);
  expect(() => prepareReviewCopyExport(rebuilt, restricted)).toThrow(/configured levels/);
  await expect(prepareCheckpointExport(received.checkpoints![0], received, restricted)).rejects.toThrow(/configured levels/);
  const backup = await buildBackup();
  expect(await idbDeleteReviewRound(received.id, received.baselineDigest)).toBe(true);
  const restored = await restoreBackup(backup);
  expect(restored.reviewRoundsRestored).toBeGreaterThan(0);
  const after = (await readReviewRound(round.id))!;
  expect(after.checkpoints).toEqual(saved.checkpoints);
  expect(() => prepareReviewCopyExport(rebuilt, restricted)).toThrow(/configured levels/);
  const restoredCopy = await buildReviewCopy(after);
  expect(() => prepareReviewCopyExport(restoredCopy, restricted)).toThrow(/configured levels/);
}, 15_000);

it('allows exactly one concurrent checkpoint update against the same round revision', async () => {
  const round = await startReviewRound('Checkpoint concurrency');
  const first = await createReviewCheckpoint(round, getSerializedSession(), null, { id: crypto.randomUUID(), label: 'First synthetic reviewer' });
  const second = await createReviewCheckpoint(round, getSerializedSession(), null, { id: crypto.randomUUID(), label: 'Second synthetic reviewer' });
  const outcomes = await Promise.all([
    idbSaveReviewCheckpoint(round, first, round.ownerDocumentId!, () => true),
    idbSaveReviewCheckpoint(round, second, round.ownerDocumentId!, () => true),
  ]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  const result = (await readReviewRound(round.id))!;
  expect(result.checkpoints).toEqual(outcomes.find(Boolean)!.checkpoints);
  expect(result.baseline).toEqual(round.baseline);
});

it('rejects corrupted checkpoint contents in reviewer copies and backup recovery', async () => {
  const round = await startReviewRound('Corrupt checkpoint recovery');
  const saved = await saveReviewCheckpoint(round.id, { id: crypto.randomUUID(), label: 'Synthetic reviewer' });
  const copy = structuredClone(await buildReviewCopy(saved));
  copy.round.checkpoints![0].reviewerLabel = 'Changed without a new checksum';
  await expect(parseReviewCopy(copy)).rejects.toThrow(/checksum/);

  const backup = JSON.parse(await buildBackup());
  const savedRound = backup.reviewRounds.find((item: { id: string }) => item.id === round.id);
  savedRound.checkpoints[0].reviewerLabel = 'Changed without a new checksum';
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  const result = await restoreBackup(JSON.stringify(backup));
  expect(result.issues?.some(issue => /review records were not restored.*checksum/i.test(issue))).toBe(true);
  expect(await readReviewRound(round.id)).toBeNull();
});
