import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, changeDocumentHistory, commitCurrentDocument, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { applyCommentMutation, reviewCommentMutation } from '@/lib/reviewCommentActions';
import { captureTextRange, resolveTextRange } from '@/lib/reviewTextRanges';
import { idbAddReviewRound, idbApplyReviewSuggestions, idbGetAllDocuments, idbReadReviewSuggestionReceipt, idbReadReviewSuggestions } from '@/lib/documentsDb';
import type { ReviewRound } from '@/lib/reviewRounds';
import { createReviewSuggestion, planReviewSuggestionHistory } from '@/lib/reviewSuggestions';
import { decideReviewSuggestion, submitReviewSuggestion } from '@/lib/reviewSuggestionActions';
import { reviewSuggestionRecordSchema, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';

vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
beforeEach(() => {
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } }));
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ paragraphs: [{ id: 'body', text: 'Before selected words after.', level: 0 }] });
});
afterEach(async () => { await flushDocumentWrites(); });
function anchor() {
  const value = useDocumentStore.getState().reviewComments!.threads[0].anchor;
  if (value.kind !== 'range') throw new Error('Expected range');
  return value;
}
async function prepare(proposed: string) {
  const range = captureTextRange(useDocumentStore.getState(), 'body', 7, 21)!;
  expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', range, author: 'Chief', text: 'Check these words.' }))).toBe('applied');
  await commitCurrentDocument();
  const documentId = useDocumentsStore.getState().currentId!, session = getSerializedSession();
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: session.timestamp,
    label: 'Whole paragraph review', sourceDocumentId: documentId, ownerDocumentId: documentId, baselineDigest: 'a'.repeat(64), baseline: { ts: session.timestamp, session } };
  await idbAddReviewRound(round);
  const proposal = createReviewSuggestion(round, { author: 'Reviewer', label: 'Paragraph replacement', changes: [{ target: { kind: 'paragraph', paragraphId: 'body', docType: 'naval_letter' }, proposed }] });
  expect((await submitReviewSuggestion(proposal)).status).toBe('committed');
  return { documentId, round, proposal };
}

it('tracks an independent whole-paragraph acceptance and persists exact comment Undo/Redo', async () => {
  const { documentId, round, proposal } = await prepare('New Before selected words after.');
  const original = structuredClone(anchor());
  expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted')).status).toBe('committed');
  expect(resolveTextRange(useDocumentStore.getState(), anchor())).toMatchObject({ status: 'current', start: 11, end: 25, text: 'selected words' });
  const accepted = structuredClone(anchor());
  expect((await idbGetAllDocuments())!.find(value => value.id === documentId)!.session.reviewComments!.threads[0].anchor).toEqual(accepted);
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
  expect(anchor()).toEqual(original);
  expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
  expect(anchor()).toEqual(accepted);
  expect(reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(documentId, round.id)).state.decisions.map(value => value.action)).toEqual(['accepted', 'reversed', 'restored']);
});

it('keeps a touched selection detached if later author typing recreates its old wording', async () => {
  const { round, proposal } = await prepare('Before replacement words after.');
  expect((await decideReviewSuggestion(round.id, proposal.id, 'accepted')).status).toBe('committed');
  expect(anchor().detached).toBe(true);
  useDocumentStore.getState().updateParagraph(0, { text: 'Before selected words after.' });
  expect(resolveTextRange(useDocumentStore.getState(), anchor()).status).toBe('changed');
});

it('rejects a paragraph Undo that smuggles changed discussion metadata into its destination', async () => {
  const { documentId, round, proposal } = await prepare('Before replacement words after.');
  const original = getSerializedSession();
  const accepted = await decideReviewSuggestion(round.id, proposal.id, 'accepted');
  const stored = (await idbGetAllDocuments())!.find(value => value.id === documentId)!;
  const acceptanceId = accepted.state.decisions[0].id;
  const after = planReviewSuggestionHistory(round, stored.session, original, accepted.state, acceptanceId, 'undo');
  const event = after.decisions.at(-1)!;
  const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`,
    documentId, createdAt: Date.now(), round: { id: round.id, baselineDigest: round.baselineDigest }, before: accepted.state, after,
    intent: { kind: 'history', acceptanceId, direction: 'undo', record: { id: event.id, decidedAt: event.decidedAt } } };
  const destination = { ...structuredClone(stored), meta: { ...stored.meta, updatedAt: stored.meta.updatedAt + 1 }, session: { ...structuredClone(stored.session), paragraphs: original.paragraphs, reviewComments: original.reviewComments } };
  const forged = structuredClone(destination);forged.session.reviewComments!.threads[0].messages[0].text = 'Smuggled discussion edit';
  expect(await idbApplyReviewSuggestions(stored, forged, operation)).toBe('failed');
  expect(await idbReadReviewSuggestionReceipt(operation.id)).toBeNull();
  expect((await idbGetAllDocuments())!.find(value => value.id === documentId)).toEqual(stored);
  expect(await idbApplyReviewSuggestions(stored, destination, operation)).toBe('committed');
  expect((await idbGetAllDocuments())!.find(value => value.id === documentId)!.session.reviewComments).toEqual(original.reviewComments);
});
