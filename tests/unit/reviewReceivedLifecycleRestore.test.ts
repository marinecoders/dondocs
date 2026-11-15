import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, openExistingDocument, useDocumentsStore } from '@/stores/documentsStore';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { idbAddReviewRound, idbDeleteReviewRound, idbGetAllDocuments, idbReadReviewCopies, idbReadReviewRounds, idbRestoreReviewRecords } from '@/lib/documentsDb';
import { buildReviewCopy, openReviewCopy, parseReviewCopy, startReviewRound, transitionReviewRound } from '@/lib/reviewRoundActions';
import { readReviewRound, reviewRoundStatus } from '@/lib/reviewRounds';
import { planReviewRoundTransition } from '@/lib/reviewRoundLifecycle';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'SYNTHETIC RECEIVED REVIEW RECOVERY');
});

afterEach(async () => {
  await flushDocumentWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('merges a newer received lifecycle from backup without replacing the retained baseline', async () => {
  const round = await startReviewRound('Received backup state');
  const activeCopy = await parseReviewCopy(await buildReviewCopy(round));
  const closed = await transitionReviewRound(round, 'close');
  const closedCopy = await parseReviewCopy(await buildReviewCopy(closed));
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(closedCopy)).toBe('applied');
  const backup = await buildBackup();

  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(activeCopy)).toBe('applied');
  const before = (await readReviewRound(round.id))!;
  expect(before.ownerDocumentId).toBeUndefined();
  expect(reviewRoundStatus(before)).toBe('active');

  const restored = await restoreBackup(backup);
  expect(restored.reviewRoundsRestored).toBeGreaterThan(0);
  expect(await readReviewRound(round.id)).toEqual({ ...before, lifecycle: closed.lifecycle });
});

it('does not roll received history back when restoring an older backup', async () => {
  const round = await startReviewRound('Received stale backup');
  const closed = await transitionReviewRound(round, 'close');
  const closedCopy = await parseReviewCopy(await buildReviewCopy(closed));
  const reopened = await transitionReviewRound(closed, 'reopen');
  const reopenedCopy = await parseReviewCopy(await buildReviewCopy(reopened));
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(closedCopy)).toBe('applied');
  const older = await buildBackup();
  expect(await openReviewCopy(reopenedCopy)).toBe('applied');
  const before = await readReviewRound(round.id);

  const restored = await restoreBackup(older);
  expect(restored.reviewRoundsRestored).toBeGreaterThan(0);
  expect(await readReviewRound(round.id)).toEqual(before);
});

it('preserves an established local owner state during public backup restore', async () => {
  const round = await startReviewRound('Local owner restore priority');
  const backup = JSON.parse(await buildBackup());
  const incoming = backup.reviewRounds.find((item: { id: string }) => item.id === round.id);
  delete incoming.ownerDocumentId;
  incoming.lifecycle = planReviewRoundTransition(round, 'close').lifecycle;

  const restored = await restoreBackup(JSON.stringify(backup));
  expect(restored.reviewRoundsRestored).toBeGreaterThan(0);
  expect(await readReviewRound(round.id)).toEqual(round);
});

it('rejects a divergent received backup history without committing other review records or links', async () => {
  const round = await startReviewRound('Received review-section atomicity');
  const retained = { ...planReviewRoundTransition(round, 'close'), ownerDocumentId: undefined };
  const divergent = { ...planReviewRoundTransition(round, 'close'), ownerDocumentId: undefined };
  const additional = { ...round, id: `review_${crypto.randomUUID()}`, ownerDocumentId: undefined };
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  expect(await idbAddReviewRound(retained)).toBe('committed');
  const before = { rounds: await idbReadReviewRounds(), links: await idbReadReviewCopies() };

  expect(await idbRestoreReviewRecords([additional, divergent], [{
    documentId: round.ownerDocumentId!, roundId: additional.id, baselineDigest: additional.baselineDigest,
  }])).toBe(false);
  expect({ rounds: await idbReadReviewRounds(), links: await idbReadReviewCopies() }).toEqual(before);
  expect(await readReviewRound(additional.id)).toBeNull();
});

it('rejects an invalid lifecycle in a public backup before any review state changes', async () => {
  const round = await startReviewRound('Malformed backup lifecycle');
  const backup = JSON.parse(await buildBackup());
  const incoming = backup.reviewRounds.find((item: { id: string }) => item.id === round.id);
  incoming.lifecycle = { events: [{ id: crypto.randomUUID(), state: 'active', changedAt: Date.now() }] };
  const before = { rounds: await idbReadReviewRounds(), links: await idbReadReviewCopies() };

  await expect(restoreBackup(JSON.stringify(backup))).rejects.toThrow(/saved review baseline is invalid/);
  expect({ rounds: await idbReadReviewRounds(), links: await idbReadReviewCopies() }).toEqual(before);
});

it('restores explicit source ownership from a full backup beside a previously received pin', async () => {
  const round = await startReviewRound('Owned source backup recovery');
  const receivedCopy = await parseReviewCopy(await buildReviewCopy(round));
  const backup = await buildBackup();
  useDocumentsStore.getState().newDocument();
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  useDocumentsStore.getState().remove(round.ownerDocumentId!);
  expect(await useDocumentsStore.getState().permanentlyDelete(round.ownerDocumentId!)).toBe(true);
  expect(await openReviewCopy(receivedCopy)).toBe('applied');
  expect((await readReviewRound(round.id))?.ownerDocumentId).toBeUndefined();

  const restored = await restoreBackup(backup);
  expect(restored.reviewRoundsRestored).toBeGreaterThan(0);
  expect((await idbGetAllDocuments())?.some(document => document.id === round.ownerDocumentId)).toBe(true);
  const recovered = (await readReviewRound(round.id))!;
  expect(recovered.ownerDocumentId).toBe(round.ownerDocumentId);
  expect(openExistingDocument(round.ownerDocumentId!)).toBe('applied');
  expect(reviewRoundStatus(await transitionReviewRound(recovered, 'close'))).toBe('closed');
});

it.each(['missing', 'mismatched'])('rejects %s backup source authority without committing any review-section records', async problem => {
  const round = await startReviewRound('Guarded source authority recovery');
  useDocumentsStore.getState().newDocument();
  await flushDocumentWrites();
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  expect(await idbAddReviewRound({ ...round, ownerDocumentId: undefined })).toBe('committed');
  const incoming = structuredClone(round);
  if (problem === 'missing') {
    useDocumentsStore.getState().remove(round.ownerDocumentId!);
    expect(await useDocumentsStore.getState().permanentlyDelete(round.ownerDocumentId!)).toBe(true);
  } else incoming.ownerDocumentId = useDocumentsStore.getState().currentId!;
  const additional = { ...round, id: `review_${crypto.randomUUID()}`, ownerDocumentId: undefined };
  const before = { rounds: await idbReadReviewRounds(), links: await idbReadReviewCopies() };

  expect(await idbRestoreReviewRecords([additional, incoming], [])).toBe(false);
  expect({ rounds: await idbReadReviewRounds(), links: await idbReadReviewCopies() }).toEqual(before);
  expect(await readReviewRound(additional.id)).toBeNull();
  expect((await readReviewRound(round.id))?.ownerDocumentId).toBeUndefined();
});

it('keeps fresh archived-baseline recovery available after permanent source deletion', async () => {
  const round = await startReviewRound('Archived baseline recovery');
  useDocumentsStore.getState().newDocument();
  await flushDocumentWrites();
  useDocumentsStore.getState().remove(round.ownerDocumentId!);
  expect(await useDocumentsStore.getState().permanentlyDelete(round.ownerDocumentId!)).toBe(true);
  const backup = await buildBackup();
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);

  const restored = await restoreBackup(backup);
  expect(restored.reviewRoundsRestored).toBeGreaterThan(0);
  expect(await readReviewRound(round.id)).toEqual(round);
  expect((await idbGetAllDocuments())?.some(document => document.id === round.ownerDocumentId)).toBe(false);
});
