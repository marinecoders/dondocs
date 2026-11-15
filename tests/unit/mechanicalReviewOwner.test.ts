import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentStore, getSerializedSession } from '@/stores/documentStore';
import { applyOwnedReviewSuggestions, captureDocumentScope, captureDocumentTarget, changeDocumentHistory,
  commitCurrentDocument, flushDocumentWrites, openExistingDocument, useDocumentsStore } from '@/stores/documentsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useProfileStore } from '@/stores/profileStore';
import { useUIStore } from '@/stores/uiStore';
import { idbAddReviewRound, idbGetAllDocuments, idbReadReviewSuggestionReceipt, idbReadReviewSuggestions } from '@/lib/documentsDb';
import { createMechanicalReviewProposal, mechanicalReviewCandidates } from '@/lib/mechanicalReviewProposals';
import { appendReviewSuggestions, emptyReviewSuggestionState, planReviewSuggestionDecision, type ReviewSuggestion, type ReviewSuggestionState } from '@/lib/reviewSuggestions';
import { reviewSuggestionRecordSchema, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import type { ReviewRound } from '@/lib/reviewRounds';

let round: ReviewRound, proposal: ReviewSuggestion, state: ReviewSuggestionState;
const saved = async () => (await idbGetAllDocuments())!.find(document => document.id === round.ownerDocumentId)!;
const savedState = async () => reviewSuggestionRecordSchema.parse(await idbReadReviewSuggestions(round.ownerDocumentId!, round.id)).state;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });sessionStorage.clear();
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ formData: { ...useDocumentStore.getState().formData, to: 'Original recipient', date: '13 November 2026', sigFirst: ' A . ' },
    paragraphs: [{ id: 'reviewed', text: 'Due 5 Nov 2026 and 06 Dec 2026.', level: 0 }, { id: 'unrelated', text: 'Unrelated body.', level: 0 }],
    references: [{ letter: 'a', title: 'Training source (notal)', url: 'https://example.com/training' }, { letter: 'b', title: 'Another source' }] });
  await commitCurrentDocument();
  const id = useDocumentsStore.getState().currentId!, session = structuredClone(useDocumentsStore.getState().docs[id].session);
  round = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, label: 'Formatting review', createdAt: session.timestamp,
    sourceDocumentId: id, ownerDocumentId: id, baselineDigest: 'a'.repeat(64), baseline: { ts: session.timestamp, session } };
  expect(await idbAddReviewRound(round)).toBe('committed');
  proposal = createMechanicalReviewProposal(round, { author: 'Example reviewer', bodyAudience: 'military',
    selectedIds: mechanicalReviewCandidates(round, 'military').filter(candidate => candidate.after !== undefined).map(candidate => candidate.id) });
  state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
  const write: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`,
    documentId: id, createdAt: Date.now(), round: { id: round.id, baselineDigest: round.baselineDigest },
    before: null, after: state, intent: { kind: 'propose', proposals: [proposal] } };
  expect(await applyOwnedReviewSuggestions(captureDocumentTarget(), write)).toBe('committed');
});
afterEach(async () => { vi.restoreAllMocks();await flushDocumentWrites();vi.clearAllTimers();vi.useRealTimers(); });

function acceptance(source = getSerializedSession()): ReviewSuggestionWrite {
  const plan = planReviewSuggestionDecision(round, source, state, proposal.id, 'accepted');
  if (plan.status !== 'ready') throw new Error('Test acceptance is stale.');
  const decision = plan.state.decisions.at(-1)!;
  return { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`,
    documentId: round.ownerDocumentId!, createdAt: Date.now(), round: { id: round.id, baselineDigest: round.baselineDigest },
    before: state, after: plan.state, intent: { kind: 'decide', proposalId: proposal.id, action: 'accepted', record: { id: decision.id, decidedAt: decision.decidedAt } } };
}

describe('formatting review groups through the existing owner queue', () => {
  it('commits the whole group while preserving newer unrelated work, then records real Undo/Redo and reload state', async () => {
    useDocumentStore.getState().setField('to', 'Later recipient');
    useDocumentStore.getState().reorderParagraphs(1, 0);
    useDocumentStore.getState().updateParagraph(0, { text: 'Later unrelated body.' });
    expect(await applyOwnedReviewSuggestions(captureDocumentTarget(), acceptance())).toBe('committed');
    expect((await saved()).session).toMatchObject({ formData: { to: 'Later recipient', date: '13 Nov 26', sigFirst: 'A.' },
      references: [{ title: 'Training source (NOTAL)', url: 'https://example.com/training' }, { title: 'Another source' }],
      paragraphs: [{ id: 'unrelated', text: 'Later unrelated body.' }, { id: 'reviewed', text: 'Due 5 November 2026 and 6 December 2026.' }] });
    expect((await savedState()).decisions.map(decision => decision.action)).toEqual(['accepted']);
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect((await saved()).session).toMatchObject({ formData: { to: 'Later recipient', date: '13 November 2026', sigFirst: ' A . ' },
      references: [{ title: 'Training source (notal)' }, { title: 'Another source' }],
      paragraphs: [{ id: 'unrelated', text: 'Later unrelated body.' }, { id: 'reviewed', text: 'Due 5 Nov 2026 and 06 Dec 2026.' }] });
    expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect((await savedState()).decisions.map(decision => decision.action)).toEqual(['accepted', 'reversed', 'restored']);
    const owner = round.ownerDocumentId!;
    useDocumentsStore.getState().newDocument();await commitCurrentDocument();expect(openExistingDocument(owner)).toBe('applied');
    expect(useHistoryStore.getState().canUndo()).toBe(false);
    expect(useDocumentStore.getState().references[0].title).toBe('Training source (NOTAL)');
    expect((await savedState()).decisions.map(decision => decision.action)).toEqual(['accepted', 'reversed', 'restored']);
  });

  it('rejects a stale reference-list group without partial field/body edits or a saved acceptance', async () => {
    const operation = acceptance();
    useDocumentStore.getState().updateReference(1, { url: 'https://example.com/later-source' });await commitCurrentDocument();
    const before = structuredClone(await saved());
    await expect(applyOwnedReviewSuggestions(captureDocumentTarget(), operation)).rejects.toThrow(/changed|decision/);
    expect(await saved()).toEqual(before);expect((await savedState()).decisions).toEqual([]);
    expect(await idbReadReviewSuggestionReceipt(operation.id)).toBeNull();
    expect(useDocumentStore.getState().formData.date).toBe('13 November 2026');
  });

  it('rolls back all durable members on metadata failure and retries the same fenced group before later input', async () => {
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (value && typeof value === 'object' && 'key' in value && String(value.key).startsWith('review-suggestions:')) throw new Error('Synthetic quota failure');
      return original.call(this, value, key);
    });
    const operation = acceptance(), before = structuredClone(await saved());
    expect(await applyOwnedReviewSuggestions(captureDocumentTarget(), operation)).toBe('pending');
    expect(await saved()).toEqual(before);expect((await savedState()).decisions).toEqual([]);
    expect(await idbReadReviewSuggestionReceipt(operation.id)).toBeNull();
    expect(useUIStore.getState().saveStatus).not.toBe('saved');
    useDocumentStore.getState().setField('to', 'Later recipient during retry');useDocumentsStore.getState().syncCurrent();
    spy.mockRestore();await flushDocumentWrites();
    expect((await saved()).session).toMatchObject({ formData: { to: 'Later recipient during retry', date: '13 Nov 26', sigFirst: 'A.' },
      references: [{ title: 'Training source (NOTAL)' }, { title: 'Another source' }] });
    expect((await savedState()).decisions.map(decision => decision.action)).toEqual(['accepted']);
    expect(await idbReadReviewSuggestionReceipt(operation.id)).toMatchObject({ writeId: operation.id });
  });
});
