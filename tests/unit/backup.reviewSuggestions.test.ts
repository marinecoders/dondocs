import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildBackup, restoreBackup } from '@/lib/backup';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentTarget, commitCurrentDocument, flushDocumentWrites, useDocumentsStore, applyOwnedReviewSuggestions } from '@/stores/documentsStore';
import { useProfileStore } from '@/stores/profileStore';
import { useUserTemplatesStore } from '@/stores/userTemplatesStore';
import { useUIStore } from '@/stores/uiStore';
import { idbDeleteReviewRound, idbGetAllDocuments, idbInstallReviewCopy, idbReadReviewSuggestions, idbDeleteDocument, idbRestoreReviewSuggestions } from '@/lib/documentsDb';
import { appendReviewSuggestions, createReviewSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision } from '@/lib/reviewSuggestions';
import { reviewSuggestionRecordSchema, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import { listReviewRounds } from '@/lib/reviewRounds';
import { buildReviewCopy, startReviewRound } from '@/lib/reviewRoundActions';

beforeEach(async () => {
  await flushDocumentWrites();
  for (const round of await listReviewRounds()) await idbDeleteReviewRound(round.id, round.baselineDigest);
  for (const document of (await idbGetAllDocuments()) ?? []) await idbDeleteDocument(document.id);
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null, hydrated: true });
  useProfileStore.setState({ profiles: {}, selectedProfile: null });useUserTemplatesStore.setState({ templates: {} });
  useUIStore.setState({ storageHealth: 'ok' });
});
afterEach(async () => { await flushDocumentWrites();vi.restoreAllMocks(); });
async function fixture(copy = false) {
  useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('to', 'Reviewed recipient');await commitCurrentDocument();
  const owner = useDocumentsStore.getState().currentId!, source = useDocumentsStore.getState().docs[owner];
  const round = await startReviewRound('Backup review');
  const session = structuredClone(round.baseline.session);
  let id = owner;
  if (copy) {
    id = crypto.randomUUID();const record = { id, meta: { ...source.meta, id }, session };
    expect(await idbInstallReviewCopy(record, round, { documentId: id, roundId: round.id, baselineDigest: round.baselineDigest })).toBe(true);
    useDocumentsStore.setState(state => ({ docs: { ...state.docs, [id]: { meta: record.meta, session } } }));useDocumentsStore.getState().switchTo(id);
  }
  const proposal = createReviewSuggestion(round, { author: 'Reviewer', label: 'Recipient', changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Proposed recipient' }] });
  const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
  const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: id, createdAt: Date.now(),
    round: { id: round.id, baselineDigest: round.baselineDigest }, before: null, after: state, intent: { kind: 'propose', proposals: [proposal] } };
  expect(await applyOwnedReviewSuggestions(captureDocumentTarget(), operation)).toBe('committed');return { owner, id, round, state, proposal };
}
it('backs up APP-only proposals with their native revision and preserves accepted decisions in version9', async () => {
  const { id, round, state, proposal } = await fixture();
  const plan = planReviewSuggestionDecision(round, getSerializedSession(), state, proposal.id, 'accepted'), decision = plan.state.decisions.at(-1)!;
  expect(await applyOwnedReviewSuggestions(captureDocumentTarget(), { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: id, createdAt: Date.now(),
    round: { id: round.id, baselineDigest: round.baselineDigest }, before: state, after: plan.state,
    intent: { kind: 'decide', proposalId: proposal.id, action: 'accepted', record: { id: decision.id, decidedAt: decision.decidedAt } } })).toBe('committed');
  const bundle = JSON.parse(await buildBackup());expect(bundle.version).toBe(9);
  expect(bundle.documents.find((record: { id: string }) => record.id === id).meta.nativeReviewText).toBe(true);
  expect(bundle.reviewSuggestions.find((record: { documentId: string }) => record.documentId === id).state.decisions[0].action).toBe('accepted');
  expect(bundle.reviewSuggestionWrites.filter((receipt: { documentId: string }) => receipt.documentId === id)).toHaveLength(2);
  expect(await idbRestoreReviewSuggestions(bundle.reviewSuggestions, bundle.reviewSuggestionWrites, bundle.documents)).toBe(true);
  const bad = structuredClone(bundle.reviewSuggestions);bad.find((record: { documentId: string }) => record.documentId === id).state.decisions = [];
  expect(await idbRestoreReviewSuggestions(bad, bundle.reviewSuggestionWrites, bundle.documents)).toBe(false);
  await idbDeleteReviewRound(round.id, round.baselineDigest);
  for (const document of (await idbGetAllDocuments()) ?? []) await idbDeleteDocument(document.id);
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null });
  const restored = await restoreBackup(JSON.stringify(bundle));expect(restored.issues).toBeUndefined();
  expect(reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(id, round.id)).state).toEqual(plan.state);
  expect(useDocumentsStore.getState().docs[id].meta.nativeReviewText).toBe(true);

});
for (const copy of [false, true]) it(`retains archived ${copy ? 'reviewer-copy' : 'source'} history after permanent deletion without blocking baseline re-export or backup`, async () => {
  const { id, round } = await fixture(copy);await flushDocumentWrites();
  expect(await idbDeleteDocument(id)).toBe(true);
  useDocumentsStore.setState(state => { const docs = { ...state.docs };delete docs[id];return { docs, currentId: null, baseline: null }; });
  const bundle = JSON.parse(await buildBackup());expect(bundle.version).toBe(9);
  expect(bundle.documents.some((document: { id: string }) => document.id === id)).toBe(false);
  expect(bundle.reviewSuggestions.some((record: { documentId: string }) => record.documentId === id)).toBe(true);
  expect(bundle.reviewRounds.some((record: { id: string }) => record.id === round.id)).toBe(true);
  expect((await buildReviewCopy(round)).round.id).toBe(round.id);
  expect(await idbRestoreReviewSuggestions(bundle.reviewSuggestions, bundle.reviewSuggestionWrites, bundle.documents)).toBe(true);
  expect(reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(id, round.id)).state.proposals).toHaveLength(1);
});
it('rejects malformed or wrong-version proposal backup metadata before changing the library', async () => {
  await fixture();const bundle = JSON.parse(await buildBackup());
  await expect(restoreBackup(JSON.stringify({ ...bundle, version: 8 }))).rejects.toThrow(/version 9/);
  const wrong = structuredClone(bundle);wrong.reviewSuggestions[0].state.baselineDigest = 'b'.repeat(64);
  await expect(restoreBackup(JSON.stringify(wrong))).rejects.toThrow();
});
