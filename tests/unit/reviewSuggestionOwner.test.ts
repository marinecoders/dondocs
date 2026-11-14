import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '@/lib/documentsDb';
import { applyOwnedReviewSuggestions, captureDocumentTarget, captureDocumentScope, changeDocumentHistory,
  commitCurrentDocument, deleteReviewRound, flushDocumentWrites, openExistingDocument, recordDocumentHistory, useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useUIStore } from '@/stores/uiStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useProfileStore } from '@/stores/profileStore';
import { appendReviewSuggestions, createReviewSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision,
  type ReviewSuggestionState } from '@/lib/reviewSuggestions';
import { reviewSuggestionRecordSchema, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import type { ReviewRound } from '@/lib/reviewRounds';

vi.mock('@/lib/documentsDb', async original => {
  const actual = await original<typeof import('@/lib/documentsDb')>();
  return { ...actual, idbApplyReviewSuggestions: vi.fn(actual.idbApplyReviewSuggestions) };
});
const actualDb = await vi.importActual<typeof db>('@/lib/documentsDb');
const write = vi.mocked(db.idbApplyReviewSuggestions);
let round: ReviewRound, state: ReviewSuggestionState;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  write.mockReset().mockImplementation(actualDb.idbApplyReviewSuggestions);
  sessionStorage.clear();useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('to', 'Original recipient');
  useDocumentStore.getState().updateParagraph(0, { text: 'Original body.' });await commitCurrentDocument();
  const id = useDocumentsStore.getState().currentId!, baseline = structuredClone(useDocumentsStore.getState().docs[id].session);
  round = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: baseline.timestamp,
    label: 'Review', sourceDocumentId: id, ownerDocumentId: id, baselineDigest: 'a'.repeat(64), baseline: { ts: baseline.timestamp, session: baseline } };
  await db.idbAddReviewRound(round);
  const proposal = createReviewSuggestion(round, { author: 'Example reviewer', label: 'Recipient', changes: [{ target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'Proposed recipient' }] });
  state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
  const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: id, createdAt: Date.now(),
    round: { id: round.id, baselineDigest: round.baselineDigest }, before: null, after: state, intent: { kind: 'propose', proposals: [proposal] } };
  expect(await applyOwnedReviewSuggestions(captureDocumentTarget(), operation)).toBe('committed');write.mockClear();
});
afterEach(async () => { write.mockImplementation(actualDb.idbApplyReviewSuggestions);await flushDocumentWrites();vi.clearAllTimers();vi.useRealTimers(); });

function acceptance(): ReviewSuggestionWrite {
  const id = round.ownerDocumentId!, source = useDocumentsStore.getState().docs[id].session;
  const plan = planReviewSuggestionDecision(round, source, state, state.proposals[0].id, 'accepted'), decision = plan.state.decisions.at(-1)!;
  return { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: id, createdAt: Date.now(),
    round: { id: round.id, baselineDigest: round.baselineDigest }, before: state, after: plan.state,
    intent: { kind: 'decide', proposalId: state.proposals[0].id, action: 'accepted', record: { id: decision.id, decidedAt: decision.decidedAt } } };
}
function hold() {
  let release!: () => void;const pending = new Promise<void>(resolve => { release = resolve; });
  write.mockImplementation(async (...args) => { await pending;return actualDb.idbApplyReviewSuggestions(...args); });
  return release;
}
const saved = async () => (await db.idbGetAllDocuments())!.find(record => record.id === round.ownerDocumentId)!;
const decisions = async () => reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(round.ownerDocumentId!, round.id)).state.decisions;

describe('review suggestion owner and ordinary history integration', () => {
  it('keeps newer body input during an acceptance transaction without acknowledging it early', async () => {
    const release = hold(), operation = acceptance();
    const result = applyOwnedReviewSuggestions(captureDocumentTarget(), operation);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(useDocumentStore.getState().formData.to).toBe('Proposed recipient');expect(useUIStore.getState().saveStatus).not.toBe('saved');
    useDocumentStore.getState().updateParagraph(0, { text: 'Newer author body.' });useDocumentsStore.getState().syncCurrent();
    release();expect(await result).toBe('committed');await flushDocumentWrites();
    expect((await saved()).session).toMatchObject({ formData: { to: 'Proposed recipient' }, paragraphs: [{ text: 'Newer author body.' }] });
    expect((await decisions()).map(item => item.action)).toEqual(['accepted']);expect(useUIStore.getState().saveStatus).toBe('saved');
  });

  it('queues explicit Undo and Redo reversals even before the acceptance transaction finishes', async () => {
    const release = hold();const result = applyOwnedReviewSuggestions(captureDocumentTarget(), acceptance());
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');expect(useDocumentStore.getState().formData.to).toBe('Original recipient');
    expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');expect(useDocumentStore.getState().formData.to).toBe('Proposed recipient');
    release();expect(await result).toBe('committed');await flushDocumentWrites();
    expect((await decisions()).map(item => item.action)).toEqual(['accepted', 'reversed', 'restored']);
    expect((await saved()).session.formData.to).toBe('Proposed recipient');
  });

  it('does not reverse an acceptance when Undo only restores unrelated newer work', async () => {
    expect(await applyOwnedReviewSuggestions(captureDocumentTarget(), acceptance())).toBe('committed');
    useDocumentStore.getState().setField('subject', 'Unrelated newer edit');
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect(useDocumentStore.getState().formData.to).toBe('Proposed recipient');expect((await decisions()).map(item => item.action)).toEqual(['accepted']);
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect(useDocumentStore.getState().formData.to).toBe('Original recipient');expect((await decisions()).map(item => item.action)).toEqual(['accepted', 'reversed']);
  });

  it('retains failed acceptance intent and newer input until the exact fence succeeds on retry', async () => {
    write.mockResolvedValue('failed');
    expect(await applyOwnedReviewSuggestions(captureDocumentTarget(), acceptance())).toBe('pending');
    expect(await decisions()).toEqual([]);expect(useUIStore.getState().saveStatus).not.toBe('saved');
    write.mockImplementation(actualDb.idbApplyReviewSuggestions);
    useDocumentStore.getState().updateParagraph(0, { text: 'Later work after storage failure.' });useDocumentsStore.getState().syncCurrent();
    await flushDocumentWrites();
    expect((await saved()).session.paragraphs[0].text).toBe('Later work after storage failure.');expect((await decisions()).map(item => item.action)).toEqual(['accepted']);
  });

  it('does not stamp another document saved when an earlier acceptance completes', async () => {
    const release = hold(), result = applyOwnedReviewSuggestions(captureDocumentTarget(), acceptance());
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    useDocumentsStore.getState().newDocument();useDocumentStore.getState().setField('subject', 'Other draft');
    const other = useDocumentsStore.getState().currentId!;await commitCurrentDocument();const stamp = useUIStore.getState().lastSavedAt;
    release();expect(await result).toBe('committed');
    expect(useDocumentsStore.getState().currentId).toBe(other);expect(useDocumentStore.getState().formData.to).not.toBe('Proposed recipient');
    expect(useUIStore.getState().lastSavedAt).toEqual(stamp);expect((await saved()).session.formData.to).toBe('Proposed recipient');
  });

  it('removes review metadata on explicit cleanup while preserving ordinary text Undo', async () => {
    expect(await applyOwnedReviewSuggestions(captureDocumentTarget(), acceptance())).toBe('committed');
    expect(await deleteReviewRound(round.id, round.baselineDigest)).toBe(true);
    expect(await db.idbReadReviewSuggestions(round.ownerDocumentId!, round.id)).toBeNull();
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect(useDocumentStore.getState().formData.to).toBe('Original recipient');
    expect(await db.idbReadReviewSuggestions(round.ownerDocumentId!, round.id)).toBeNull();
    expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect(useDocumentStore.getState().formData.to).toBe('Proposed recipient');
    expect(await db.idbReadReviewSuggestions(round.ownerDocumentId!, round.id)).toBeNull();
  });

  it('keeps normal activation-cleared Undo semantics while retaining durable decision history', async () => {
    expect(await applyOwnedReviewSuggestions(captureDocumentTarget(), acceptance())).toBe('committed');
    useDocumentsStore.getState().newDocument();await commitCurrentDocument();
    expect(openExistingDocument(round.ownerDocumentId!)).toBe('applied');
    expect(useHistoryStore.getState().canUndo()).toBe(false);expect(useDocumentStore.getState().formData.to).toBe('Proposed recipient');
    expect((await decisions()).map(item => item.action)).toEqual(['accepted']);
    useDocumentStore.getState().setField('subject', 'Ordinary edit');recordDocumentHistory(captureDocumentScope());
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect((await decisions()).map(item => item.action)).toEqual(['accepted']);
  });
});
