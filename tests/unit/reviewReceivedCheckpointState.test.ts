import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { idbDeleteReviewRound } from '@/lib/documentsDb';
import { saveReviewCheckpoint } from '@/lib/reviewCheckpointActions';
import { buildReviewCopy, openReviewCopy, parseReviewCopy, startReviewRound, transitionReviewRound } from '@/lib/reviewRoundActions';
import { readReviewRound } from '@/lib/reviewRounds';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'SYNTHETIC RECEIVED CHECKPOINT PRIORITY');
});

afterEach(async () => {
  await flushDocumentWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(['reviewer copy', 'workspace backup'])('keeps local comparison markers when a %s advances received lifecycle', async boundary => {
  const round = await startReviewRound('Comparison markers remain independent');
  const earlier = await parseReviewCopy(await buildReviewCopy(round));
  const closed = await transitionReviewRound(round, 'close');
  const incomingMarker = await saveReviewCheckpoint(round.id, { id: crypto.randomUUID(), label: 'Incoming synthetic reviewer' });
  const later = await parseReviewCopy(await buildReviewCopy(incomingMarker));
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);

  let backup: string | undefined;
  if (boundary === 'workspace backup') {
    useDocumentsStore.getState().newDocument();
    expect(await openReviewCopy(later)).toBe('applied');
    backup = await buildBackup();
    expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  }
  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(earlier)).toBe('applied');
  const retained = await saveReviewCheckpoint(round.id, { id: crypto.randomUUID(), label: 'Local synthetic reviewer' });
  expect(retained.ownerDocumentId).toBeUndefined();
  expect(retained.checkpoints).toHaveLength(1);

  if (boundary === 'reviewer copy') expect(await openReviewCopy(later)).toBe('applied');
  else expect((await restoreBackup(backup!)).reviewRoundsRestored).toBeGreaterThan(0);

  expect(await readReviewRound(round.id)).toEqual({ ...retained, lifecycle: closed.lifecycle });
  expect((await readReviewRound(round.id))!.checkpoints![0].reviewerLabel).toBe('Local synthetic reviewer');
});
