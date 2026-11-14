import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { idbAddReviewRound, idbApplyReviewSuggestions, idbGetAllDocuments, idbPutDocument, idbReadReviewSuggestionReceipt,
  idbReadReviewSuggestions, type StoredDocument } from '@/lib/documentsDb';
import { recoverReviewReturnWrite } from '@/lib/reviewReturnRecovery';
import type { PendingDocumentWrite } from '@/lib/documentWrites';
import type { ReviewRound } from '@/lib/reviewRounds';
import { createReviewSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision } from '@/lib/reviewSuggestions';
import type { ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';

async function fixture() {
  const id = crypto.randomUUID(), session = createBlankSession();session.formData.to = 'Original recipient';
  const before: StoredDocument = { id, meta: { id, title: 'Draft', docType: 'naval_letter', updatedAt: 1 }, session };
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 1,
    label: 'Example', sourceDocumentId: id, ownerDocumentId: id, baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session } };
  const proposal = createReviewSuggestion(round, { author: 'Example', label: 'Recipient', changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Proposed recipient' }] });
  const state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
  const propose: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: id, createdAt: 2,
    round: { id: round.id, baselineDigest: round.baselineDigest }, before: null, after: state, intent: { kind: 'propose', proposals: [proposal] } };
  const proposed = { ...structuredClone(before), meta: { ...before.meta, updatedAt: 2 } };
  const plan = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted'), decision = plan.state.decisions[0];
  const accept: ReviewSuggestionWrite = { ...propose, id: `suggestion-write_${crypto.randomUUID()}`, createdAt: 3, before: state, after: plan.state,
    intent: { kind: 'decide', proposalId: proposal.id, action: 'accepted', record: { id: decision.id, decidedAt: decision.decidedAt } } };
  const accepted: StoredDocument = { ...structuredClone(before), meta: { ...before.meta, updatedAt: 3 }, session: plan.session };
  const latest = structuredClone(accepted);latest.session.formData.subject = 'Newer body work';latest.meta.updatedAt = 4;
  const pending: PendingDocumentWrite = { before, versions: [proposed, accepted, latest], reviewReturns: [{ index: 0, operation: propose }, { index: 1, operation: accept }] };
  await idbPutDocument(before);await idbAddReviewRound(round);
  const saved = async () => (await idbGetAllDocuments())!.find(record => record.id === id)!;
  return { id, before, round, propose, proposed, accept, accepted, latest, pending, saved };
}

describe('typed suggestion write recovery', () => {
  it('replays proposal metadata, acceptance and newer edits through their original fences', async () => {
    const input = await fixture();expect(await recoverReviewReturnWrite(input.pending)).toBe('committed');
    expect(await input.saved()).toEqual(input.latest);
    expect(await idbReadReviewSuggestions(input.id, input.round.id)).toMatchObject({ state: { decisions: [{ action: 'accepted' }] } });
    expect(await idbReadReviewSuggestionReceipt(input.propose.id)).not.toBeNull();expect(await idbReadReviewSuggestionReceipt(input.accept.id)).not.toBeNull();
    expect(await recoverReviewReturnWrite(input.pending)).toBe('already-committed');
  });

  it('continues after an earlier atomic fence committed before interruption', async () => {
    const input = await fixture();await idbApplyReviewSuggestions(input.before, input.proposed, input.propose);
    expect(await recoverReviewReturnWrite(input.pending)).toBe('committed');expect(await input.saved()).toEqual(input.latest);
  });

  it('never invents missing acceptance metadata for an already saved later document', async () => {
    const input = await fixture();await idbPutDocument(input.latest);
    expect(await recoverReviewReturnWrite(input.pending)).toBe('conflict');expect(await input.saved()).toEqual(input.latest);
    expect(await idbReadReviewSuggestions(input.id, input.round.id)).toBeNull();
  });

  it('does not overwrite an unknown newer revision or replay an accepted action over another tab Undo', async () => {
    const input = await fixture(), foreign = structuredClone(input.before);foreign.session.formData.subject = 'Foreign work';foreign.meta.updatedAt = 999;
    await idbPutDocument(foreign);expect(await recoverReviewReturnWrite(input.pending)).toBe('conflict');expect(await input.saved()).toEqual(foreign);
    await idbPutDocument(input.before);await idbApplyReviewSuggestions(input.before, input.proposed, input.propose);await idbApplyReviewSuggestions(input.proposed, input.accepted, input.accept);
    await idbPutDocument(input.before);
    expect(await recoverReviewReturnWrite(input.pending)).toBe('conflict');expect(await input.saved()).toEqual(input.before);
  });

  it('validates all later metadata before performing even the first queued write', async () => {
    const input = await fixture(), bad = structuredClone(input.pending);
    const operation = bad.reviewReturns![1].operation;
    if (operation.kind !== 'suggestion-write') throw new Error('Expected suggestion fixture.');
    operation.after.decisions[0].action = 'rejected';
    await expect(recoverReviewReturnWrite(bad)).rejects.toThrow(/Invalid suggestion recovery intent/);
    expect(await input.saved()).toEqual(input.before);expect(await idbReadReviewSuggestionReceipt(input.propose.id)).toBeNull();
  });
});
