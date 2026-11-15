import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, commitCurrentDocument, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { buildReviewCopy, parseReviewCopy, startReviewRound, transitionReviewRound } from '@/lib/reviewRoundActions';
import { parseReviewRound, readReviewRound, reviewRoundStatus } from '@/lib/reviewRounds';
import { planReviewRoundTransition } from '@/lib/reviewRoundLifecycle';
import { idbTransitionReviewRound } from '@/lib/documentsDb';
import { createReviewSuggestion } from '@/lib/reviewSuggestions';
import { submitReviewSuggestion } from '@/lib/reviewSuggestionActions';
import { buildBackup } from '@/lib/backup';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'FICTIONAL LIFECYCLE SOURCE');
});
afterEach(async () => {
  await flushDocumentWrites();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('review round lifecycle', () => {
  it('treats legacy rounds as active without rewriting their serialized records', async () => {
    const round = await startReviewRound('Legacy active');
    expect(reviewRoundStatus(round)).toBe('active');
    expect(parseReviewRound(round)).not.toHaveProperty('lifecycle');
  });

  it('closes and deliberately reopens while retaining baseline and append-only state history', async () => {
    const round = await startReviewRound('Close then reopen');
    const closed = await transitionReviewRound(round, 'close');
    expect(reviewRoundStatus(closed)).toBe('closed');
    expect(closed.baseline).toEqual(round.baseline);
    expect(closed.baselineDigest).toBe(round.baselineDigest);
    await expect(transitionReviewRound(round, 'close')).rejects.toThrow(/changed/);
    const reopened = await transitionReviewRound(closed, 'reopen');
    expect(reopened.lifecycle?.events.map(event => event.state)).toEqual(['closed', 'active']);
    expect((await readReviewRound(round.id))?.baseline).toEqual(round.baseline);
  });

  it('links only a newer active round of the same owner and makes supersession terminal', async () => {
    const round = await startReviewRound('Earlier review');
    vi.advanceTimersByTime(1);
    const replacement = await startReviewRound('Replacement review');
    expect(() => planReviewRoundTransition(replacement, 'supersede', round)).toThrow(/newer active/);
    expect(() => planReviewRoundTransition(round, 'supersede', { ...replacement, ownerDocumentId: 'other-source' })).toThrow(/same source/);
    const superseded = await transitionReviewRound(round, 'supersede', replacement.id);
    expect(superseded.lifecycle?.events.at(-1)?.replacementRoundId).toBe(replacement.id);
    await expect(transitionReviewRound(superseded, 'reopen')).rejects.toThrow(/state changed/);
    expect((await readReviewRound(replacement.id))?.baselineDigest).toBe(replacement.baselineDigest);
  });

  it('rejects concurrent state updates, changed baselines and inactive replacements atomically', async () => {
    const round = await startReviewRound('Competing state');
    vi.advanceTimersByTime(1);
    const replacement = await startReviewRound('Replacement');
    const planned = planReviewRoundTransition(round, 'supersede', replacement);
    await transitionReviewRound(replacement, 'close');
    expect(await idbTransitionReviewRound(round, planned, () => true)).toBe(false);
    const altered = planReviewRoundTransition(round, 'close');
    altered.baseline.session.formData.subject = 'Changed historical content';
    expect(await idbTransitionReviewRound(round, altered, () => true)).toBe(false);
    expect(await idbTransitionReviewRound(round, planReviewRoundTransition(round, 'close'), () => false)).toBe(false);
    expect(reviewRoundStatus((await readReviewRound(round.id))!)).toBe('active');
  });

  it('does not let a received baseline or changed source activation change state', async () => {
    const round = await startReviewRound('Source-only lifecycle');
    const target = captureDocumentTarget();
    useDocumentStore.getState().setField('subject', 'Newer source edit');
    await expect(transitionReviewRound(round, 'close', undefined, target)).rejects.toThrow(/document changed/);
    await expect(transitionReviewRound({ ...round, ownerDocumentId: undefined }, 'close')).rejects.toThrow(/original source/);
    expect(reviewRoundStatus((await readReviewRound(round.id))!)).toBe('active');
  });

  it('blocks new proposals on closed rounds and retains portable and backup state', async () => {
    const round = await startReviewRound('Retained closed history');
    const closed = await transitionReviewRound(round, 'close');
    const proposal = createReviewSuggestion(round, { author: 'Example reviewer', label: 'Subject', category: 'edit',
      changes: [{ target: { kind: 'field', field: 'subject', docType: 'naval_letter' }, proposed: 'New subject' }] });
    await expect(submitReviewSuggestion(proposal)).rejects.toThrow(/closed or superseded/);
    const copy = await buildReviewCopy(closed);
    expect((await parseReviewCopy(copy)).envelope.round.lifecycle).toEqual(closed.lifecycle);
    await commitCurrentDocument();
    const backup = JSON.parse(await buildBackup());
    expect(backup.reviewRounds.find((value: { id: string }) => value.id === round.id).lifecycle).toEqual(closed.lifecycle);
  });

  it('rejects forged lifecycle sequences and duplicate event identities', async () => {
    const round = await startReviewRound('Invalid states');
    const closed = planReviewRoundTransition(round, 'close');
    const duplicate = structuredClone(closed);
    duplicate.lifecycle!.events.push({ ...duplicate.lifecycle!.events[0], state: 'active' });
    expect(() => parseReviewRound(duplicate)).toThrow(/invalid/);
    const activeEvent = { ...closed.lifecycle!.events[0], state: 'active' };
    expect(() => parseReviewRound({ ...round, lifecycle: { events: [activeEvent] } })).toThrow(/invalid/);
  });
});
