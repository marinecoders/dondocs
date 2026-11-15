import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { idbDeleteReviewRound, idbGetAllDocuments, idbInstallReviewCopy, idbReadReviewCopies, type StoredDocument } from '@/lib/documentsDb';
import { buildReviewCopy, openReviewCopy, parseReviewCopy, startReviewRound, transitionReviewRound } from '@/lib/reviewRoundActions';
import { readReviewRound, reviewRoundStatus, type ReviewRound } from '@/lib/reviewRounds';
import { mergeReceivedReviewLifecycle } from '@/lib/reviewRoundLifecycle';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'SYNTHETIC RECEIVED ROUND UPDATE');
});

afterEach(async () => {
  await flushDocumentWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function reviewStorage(roundId: string) {
  return {
    documents: await idbGetAllDocuments(),
    links: await idbReadReviewCopies(),
    round: await readReviewRound(roundId),
  };
}

it('retains the status of a newly received copy when the same received baseline was imported earlier', async () => {
  const round = await startReviewRound('Received lifecycle update');
  const earlier = await parseReviewCopy(await buildReviewCopy(round));
  const closed = await transitionReviewRound(round, 'close');
  const later = await parseReviewCopy(await buildReviewCopy(closed));
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);

  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(earlier)).toBe('applied');
  expect((await readReviewRound(round.id))?.ownerDocumentId).toBeUndefined();
  expect(reviewRoundStatus((await readReviewRound(round.id))!)).toBe('active');

  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(later)).toBe('applied');
  expect(reviewRoundStatus((await readReviewRound(round.id))!)).toBe('closed');
});

it('advances a received close and reopen without replacing its other baseline metadata', async () => {
  const round = await startReviewRound('Retained receiver label');
  const closed = await transitionReviewRound(round, 'close');
  const reopened = await transitionReviewRound(closed, 'reopen');
  const initial = await parseReviewCopy(await buildReviewCopy(round));
  const incoming = structuredClone(await buildReviewCopy(reopened));
  incoming.round.label = 'A different incoming label';
  const newer = await parseReviewCopy(incoming);
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);

  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(initial)).toBe('applied');
  const retained = (await readReviewRound(round.id))!;
  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(newer)).toBe('applied');
  expect(await readReviewRound(round.id)).toEqual({ ...retained, lifecycle: reopened.lifecycle });
});

it('retains supersession and does not roll received state back when an older copy is opened', async () => {
  const round = await startReviewRound('Earlier received round');
  const earlier = await parseReviewCopy(await buildReviewCopy(round));
  vi.advanceTimersByTime(1);
  const replacement = await startReviewRound('Replacement round');
  const superseded = await transitionReviewRound(round, 'supersede', replacement.id);
  const later = await parseReviewCopy(await buildReviewCopy(superseded));
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);

  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(earlier)).toBe('applied');
  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(later)).toBe('applied');
  const received = (await readReviewRound(round.id))!;
  expect(reviewRoundStatus(received)).toBe('superseded');
  expect(received.lifecycle).toEqual(superseded.lifecycle);
  expect(await openReviewCopy(earlier)).toBe('applied');
  expect(await readReviewRound(round.id)).toEqual(received);
});

it.each([false, true])('rejects a divergent received history atomically (longer: %s)', async longer => {
  const round = await startReviewRound('Conflicting received histories');
  const closed = await transitionReviewRound(round, 'close');
  const first = await parseReviewCopy(await buildReviewCopy(closed));
  const divergent = structuredClone(await buildReviewCopy(closed));
  divergent.round.lifecycle!.events[0].id = crypto.randomUUID();
  if (longer) divergent.round.lifecycle!.events.push({ id: crypto.randomUUID(), state: 'active', changedAt: Date.now() });
  const conflict = await parseReviewCopy(divergent);
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(first)).toBe('applied');
  await flushDocumentWrites();
  const before = await reviewStorage(round.id);

  await expect(openReviewCopy(conflict)).rejects.toThrow(/could not be saved completely/);
  expect(await reviewStorage(round.id)).toEqual(before);
});

it('keeps a local owner pin intact when a received history differs', async () => {
  const round = await startReviewRound('Local owner');
  const incoming = structuredClone(await buildReviewCopy(round));
  incoming.round.lifecycle = { events: [{ id: crypto.randomUUID(), state: 'closed', changedAt: Date.now() }] };
  const received = await parseReviewCopy(incoming);
  expect(await openReviewCopy(received)).toBe('applied');
  expect(await readReviewRound(round.id)).toEqual(round);
});

it('rejects malformed history before writing a document or association', async () => {
  const round = await startReviewRound('Malformed received history');
  const id = crypto.randomUUID();
  const document: StoredDocument = {
    id,
    meta: { id, title: 'Synthetic invalid received copy', docType: 'naval_letter', updatedAt: Date.now() },
    session: getSerializedSession(),
  };
  const invalid = { ...round, ownerDocumentId: undefined,
    lifecycle: { events: [{ id: crypto.randomUUID(), state: 'active', changedAt: Date.now() }] } } as ReviewRound;
  await flushDocumentWrites();
  const before = await reviewStorage(round.id);
  expect(await idbInstallReviewCopy(document, invalid, { documentId: id, roundId: round.id, baselineDigest: round.baselineDigest })).toBe(false);
  expect(await reviewStorage(round.id)).toEqual(before);
});

it('keeps identical received state stable and rejects a duplicate stored document identity', async () => {
  const round = await startReviewRound('Repeated received copy');
  const closed = await transitionReviewRound(round, 'close');
  const copy = await parseReviewCopy(await buildReviewCopy(closed));
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  useDocumentsStore.getState().newDocument();
  expect(await openReviewCopy(copy)).toBe('applied');
  const retained = (await readReviewRound(round.id))!;
  expect(mergeReceivedReviewLifecycle(retained, retained)).toEqual(retained);
  const id = useDocumentsStore.getState().currentId!;
  const document = (await idbGetAllDocuments())!.find(item => item.id === id)!;
  const beforeLinks = await idbReadReviewCopies();
  expect(await idbInstallReviewCopy(document, retained, { documentId: id, roundId: round.id, baselineDigest: round.baselineDigest })).toBe(false);
  expect(await idbReadReviewCopies()).toEqual(beforeLinks);
  expect(await readReviewRound(round.id)).toEqual(retained);
});

it('keeps the longest compatible history when two received documents commit concurrently', async () => {
  const round = await startReviewRound('Concurrent received copies');
  const closed = await transitionReviewRound(round, 'close');
  const reopened = await transitionReviewRound(closed, 'reopen');
  expect(await idbDeleteReviewRound(round.id, round.baselineDigest)).toBe(true);
  const copy = (pin: ReviewRound) => {
    const id = crypto.randomUUID();
    const document: StoredDocument = {
      id,
      meta: { id, title: 'Synthetic concurrent received copy', docType: 'naval_letter', updatedAt: Date.now() },
      session: getSerializedSession(),
    };
    return idbInstallReviewCopy(document, { ...pin, ownerDocumentId: undefined },
      { documentId: id, roundId: pin.id, baselineDigest: pin.baselineDigest });
  };
  expect(await Promise.all([copy(reopened), copy(closed)])).toEqual([true, true]);
  const received = (await readReviewRound(round.id))!;
  expect(received.lifecycle).toEqual(reopened.lifecycle);
  expect(received.ownerDocumentId).toBeUndefined();
});
