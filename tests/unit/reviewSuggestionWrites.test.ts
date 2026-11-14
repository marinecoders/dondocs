import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import {
  idbAddReviewRound, idbApplyReviewSuggestions, idbGetAllDocuments, idbInstallReviewCopy, idbPutDocument,
  idbReadReviewSuggestionReceipt, idbReadReviewSuggestions, type StoredDocument,
} from '@/lib/documentsDb';
import type { ReviewRound } from '@/lib/reviewRounds';
import { appendReviewSuggestions, createReviewSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision,
  planReviewSuggestionHistory } from '@/lib/reviewSuggestions';
import { planReviewSuggestionWrite, reviewSuggestionRecordSchema, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';

async function fixture() {
  const id = crypto.randomUUID(), session = createBlankSession();
  session.timestamp = 100;session.formData.to = 'Original recipient';session.paragraphs = [{ id: 'paragraph-one', text: 'Original body.', level: 0 }];
  const before: StoredDocument = { id, meta: { id, title: 'Example draft', docType: 'naval_letter', updatedAt: 100 }, session };
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt: 100, label: 'Example', sourceDocumentId: id, ownerDocumentId: id, baselineDigest: 'a'.repeat(64), baseline: { ts: 100, session: structuredClone(session) } };
  const proposal = createReviewSuggestion(round, { author: 'Example reviewer', label: 'Recipient', changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Proposed recipient' }] });
  const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
  const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: id,
    createdAt: 200, round: { id: round.id, baselineDigest: round.baselineDigest }, before: null, after: state,
    intent: { kind: 'propose', proposals: [proposal] } };
  const after = structuredClone(before);after.meta.updatedAt = 200;
  expect(await idbPutDocument(before)).toBe(true);expect(await idbAddReviewRound(round)).toBe('committed');
  const accept = () => {
    const planned = planReviewSuggestionDecision(round, after.session, state, proposal.id, 'accepted');
    const decision = planned.state.decisions.at(-1)!;
    const write: ReviewSuggestionWrite = { ...operation, id: `suggestion-write_${crypto.randomUUID()}`, createdAt: 300, before: state,
      after: planned.state, intent: { kind: 'decide', proposalId: proposal.id, action: 'accepted', record: { id: decision.id, decidedAt: decision.decidedAt } } };
    const saved: StoredDocument = { ...structuredClone(after), meta: { ...after.meta, updatedAt: 300, nativeReviewText: true }, session: planned.session };
    return { write, saved, planned };
  };
  const read = async () => (await idbGetAllDocuments())!.find(document => document.id === id)!;
  return { id, before, after, round, proposal, state, operation, accept, read };
}

describe('atomic source-bound review proposal writes', () => {
  it('revalidates a reconciled current value and commits its exact before/after values with one receipt', async () => {
    const input = await fixture();await idbApplyReviewSuggestions(input.before, input.after, input.operation);
    const current = structuredClone(input.after);current.session.formData.to = 'Newer author recipient';current.meta.updatedAt = 250;
    await idbPutDocument(current);
    const resolutions = [{ changeId: input.proposal.changes[0].id, expectedCurrent: current.session.formData.to, value: 'Combined recipient' }];
    const plan = planReviewSuggestionDecision(input.round, current.session, input.state, input.proposal.id, 'accepted', undefined, resolutions);
    const decision = plan.state.decisions[0];
    const operation: ReviewSuggestionWrite = { ...input.operation, id: `suggestion-write_${crypto.randomUUID()}`, before: input.state, after: plan.state,
      intent: { kind: 'decide', proposalId: input.proposal.id, action: 'accepted', record: { id: decision.id, decidedAt: decision.decidedAt }, resolutions } };
    const after = { ...structuredClone(current), meta: { ...current.meta, updatedAt: 300, nativeReviewText: true as const }, session: plan.session };
    const late = structuredClone(current);late.session.formData.to = 'Foreign tab recipient';late.meta.updatedAt++;
    await idbPutDocument(late);expect(await idbApplyReviewSuggestions(current, after, operation)).toBe('conflict');
    expect(await input.read()).toEqual(late);expect(await idbReadReviewSuggestionReceipt(operation.id)).toBeNull();
    await idbPutDocument(current);
    const forged = structuredClone(after);forged.session.formData.subject = 'Unrelated overwrite';
    expect(await idbApplyReviewSuggestions(current, forged, operation)).toBe('conflict');
    const wrongCapture = structuredClone(operation);if (wrongCapture.intent.kind === 'decide') wrongCapture.intent.resolutions![0].expectedCurrent = 'Forged current';
    expect(await idbApplyReviewSuggestions(current, after, wrongCapture)).toBe('failed');
    expect(await input.read()).toEqual(current);
    expect(await idbApplyReviewSuggestions(current, after, operation)).toBe('committed');
    expect(reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(input.id, input.round.id)).state.decisions[0].resolutions).toEqual(resolutions);
    expect(await idbApplyReviewSuggestions(current, after, operation)).toBe('already-committed');
  });

  it('commits proposal metadata with its source receipt without editing document text', async () => {
    const input = await fixture();
    expect(await idbApplyReviewSuggestions(input.before, input.after, input.operation)).toBe('committed');
    expect((await input.read()).session).toEqual(input.before.session);
    expect(reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(input.id, input.round.id)).state).toEqual(input.state);
    expect(await idbReadReviewSuggestionReceipt(input.operation.id)).toMatchObject({ writeId: input.operation.id, documentId: input.id });
  });

  it('atomically accepts only the planned replacement and records its decision', async () => {
    const input = await fixture();await idbApplyReviewSuggestions(input.before, input.after, input.operation);
    const { write, saved, planned } = input.accept();
    expect(await idbApplyReviewSuggestions(input.after, saved, write)).toBe('committed');
    expect(await input.read()).toEqual(saved);
    expect(reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(input.id, input.round.id)).state).toEqual(planned.state);
    expect(await idbApplyReviewSuggestions(input.after, saved, write)).toBe('already-committed');
    const later = structuredClone(saved);later.session.formData.subject = 'Newer author work';later.meta.updatedAt++;
    await idbPutDocument(later);
    expect(await idbApplyReviewSuggestions(input.after, saved, write)).toBe('already-imported');
    expect(await input.read()).toEqual(later);
  });

  it('rejects unrelated queued document changes or forged decisions without writing metadata', async () => {
    const input = await fixture();
    const forged = structuredClone(input.after);forged.session.paragraphs[0].text = 'Unrelated overwrite';
    expect(await idbApplyReviewSuggestions(input.before, forged, input.operation)).toBe('conflict');
    expect(await input.read()).toEqual(input.before);expect(await idbReadReviewSuggestions(input.id, input.round.id)).toBeNull();
    await idbApplyReviewSuggestions(input.before, input.after, input.operation);
    const { write, saved } = input.accept();write.after.decisions[0].action = 'rejected';
    expect(await idbApplyReviewSuggestions(input.after, saved, write)).toBe('conflict');
    expect((await input.read()).session.formData.to).toBe('Original recipient');
    expect(await idbReadReviewSuggestionReceipt(write.id)).toBeNull();
  });

  it('permits the native reader hint only with a validated acceptance and rejects unrelated metadata', async () => {
    const input = await fixture(), invalid = structuredClone(input.after);invalid.meta.nativeReviewText = true;
    expect(await idbApplyReviewSuggestions(input.before, invalid, input.operation)).toBe('conflict');
    expect(await idbApplyReviewSuggestions(input.before, input.after, input.operation)).toBe('committed');
    const { write, saved } = input.accept(), unhinted = structuredClone(saved);delete unhinted.meta.nativeReviewText;
    expect(await idbApplyReviewSuggestions(input.after, unhinted, write)).toBe('conflict');
    const renamed = structuredClone(saved);renamed.meta.title = 'Unrelated new title';
    expect(await idbApplyReviewSuggestions(input.after, renamed, write)).toBe('conflict');
    expect(await idbReadReviewSuggestionReceipt(write.id)).toBeNull();
    expect(await idbApplyReviewSuggestions(input.after, saved, write)).toBe('committed');
  });

  it('preserves a newer foreign edit and stale metadata rather than overwriting either', async () => {
    const input = await fixture();await idbApplyReviewSuggestions(input.before, input.after, input.operation);
    const { write, saved } = input.accept();
    const newer = structuredClone(input.after);newer.session.formData.to = 'Other tab recipient';newer.meta.updatedAt++;
    await idbPutDocument(newer);
    expect(await idbApplyReviewSuggestions(input.after, saved, write)).toBe('conflict');
    expect(await input.read()).toEqual(newer);expect(await idbReadReviewSuggestionReceipt(write.id)).toBeNull();
  });

  it('permits proposals on a bound reviewer copy but never source-owner decisions', async () => {
    const input = await fixture(), id = crypto.randomUUID();
    const copy: StoredDocument = { ...structuredClone(input.before), id, meta: { ...input.before.meta, id } };
    expect(await idbInstallReviewCopy(copy, input.round, { documentId: id, roundId: input.round.id, baselineDigest: input.round.baselineDigest })).toBe(true);
    const operation = { ...input.operation, documentId: id };
    const after = { ...structuredClone(copy), meta: { ...copy.meta, updatedAt: 200 } };
    expect(await idbApplyReviewSuggestions(copy, after, operation)).toBe('committed');
    const { write, saved } = input.accept();write.documentId = id;
    saved.id = id;saved.meta.id = id;
    expect(await idbApplyReviewSuggestions(after, saved, write)).toBe('conflict');
    expect(await idbReadReviewSuggestionReceipt(write.id)).toBeNull();
  });

  it('rolls the whole transaction back if saving review metadata fails after its document put', async () => {
    const input = await fixture();
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (value && typeof value === 'object' && 'key' in value && String(value.key).startsWith('review-suggestions:')) throw new Error('Quota failure');
      return original.call(this, value, key);
    });
    try { expect(await idbApplyReviewSuggestions(input.before, input.after, input.operation)).toBe('failed'); }
    finally { spy.mockRestore(); }
    expect(await input.read()).toEqual(input.before);expect(await idbReadReviewSuggestions(input.id, input.round.id)).toBeNull();
    expect(await idbReadReviewSuggestionReceipt(input.operation.id)).toBeNull();
  });

  it('atomically stores an explicit acceptance Undo and Redo while retaining the original decision', async () => {
    const input = await fixture();await idbApplyReviewSuggestions(input.before, input.after, input.operation);
    const { write: accepted, saved } = input.accept();await idbApplyReviewSuggestions(input.after, saved, accepted);
    const reverse = planReviewSuggestionHistory(input.round, saved.session, input.before.session, accepted.after, accepted.after.decisions[0].id, 'undo');
    const event = reverse.decisions.at(-1)!;
    const operation: ReviewSuggestionWrite = { ...accepted, id: `suggestion-write_${crypto.randomUUID()}`, createdAt: 400, before: accepted.after, after: reverse,
      intent: { kind: 'history', acceptanceId: accepted.after.decisions[0].id, direction: 'undo', record: { id: event.id, decidedAt: event.decidedAt } } };
    const undone = { ...structuredClone(saved), meta: { ...saved.meta, updatedAt: 400 }, session: structuredClone(input.before.session) };
    expect(await idbApplyReviewSuggestions(saved, undone, operation)).toBe('committed');
    expect((await input.read()).session.formData.to).toBe('Original recipient');
    expect(reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(input.id, input.round.id)).state.decisions.map(item => item.action)).toEqual(['accepted', 'reversed']);
    const unrelated = structuredClone(undone);unrelated.session.formData.subject = 'Unrelated overwrite';
    expect(planReviewSuggestionWrite(input.round, saved.session, operation, unrelated.session).session.formData.subject).toBe(saved.session.formData.subject);
  });
});
