import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as db from '@/lib/documentsDb';
import { getExportDeploymentPolicy } from '@/config/classification';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { getSerializedSession, useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, changeDocumentHistory, commitCurrentDocument, flushDocumentWrites, openExistingDocument, useDocumentsStore } from '@/stores/documentsStore';
import { useProfileStore } from '@/stores/profileStore';
import { startReviewRound } from '@/lib/reviewRoundActions';
import { listReviewRounds, parseReviewRound } from '@/lib/reviewRounds';
import { decideReviewSuggestion, loadReviewSuggestionWorkspace, submitReviewSuggestion } from '@/lib/reviewSuggestionActions';
import { appendReviewSuggestions, createParagraphStructureSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision, validateReviewSuggestionState } from '@/lib/reviewSuggestions';
import { reviewSuggestionRecordSchema, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import { captureTextRange } from '@/lib/reviewTextRanges';
import { buildBackup, restoreBackup } from '@/lib/backup';

vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
const saved = async (id: string) => (await db.idbGetAllDocuments())!.find(document => document.id === id)!;
async function clearDurable() {
  for (const round of await listReviewRounds()) await db.idbDeleteReviewRound(round.id, round.baselineDigest);
  for (const document of await db.idbGetAllDocuments() ?? []) await db.idbDeleteDocument(document.id);
}
beforeEach(async () => {
  await flushDocumentWrites();await clearDurable();
  vi.mocked(getExportDeploymentPolicy).mockResolvedValue(policy);
  sessionStorage.clear();useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ documentMode: 'custom', documentCategory: 'correspondence', docType: 'naval_letter',
    formData: { subject: 'SYNTHETIC CROSS IDENTITY AUDIT', from: 'Synthetic office', to: 'Synthetic reviewer', classLevel: 'unclassified' },
    paragraphs: [{ id: 'audit-a', text: 'Alpha beta.', level: 0 }, { id: 'audit-b', text: 'Destination.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [] });
  useDocumentStore.setState({ reviewComments: { version: 3, threads: [{ id: crypto.randomUUID(), anchor: captureTextRange(getSerializedSession(), 'audit-a', 6, 10)!,
    resolved: false, messages: [{ id: crypto.randomUUID(), author: 'Synthetic reviewer', text: 'Preserve this exact discussion.', createdAt: '2026-11-15T00:00:00Z' }] }] } });
  await commitCurrentDocument();
});
afterEach(async () => { await flushDocumentWrites();vi.restoreAllMocks(); });

it.each(['insert-paragraph', 'split-paragraph'] as const)('combines %s identity ownership with moves, reacceptance, durable replay and backup restore', async kind => {
  const original = structuredClone(getSerializedSession());
  const round = await startReviewRound('Original chronology');
  const introduction = createParagraphStructureSuggestion(round, { author: 'Reviewer', operation: kind === 'insert-paragraph'
    ? { kind, index: 1, text: 'Generated independent sibling.', level: 0, paragraphId: 'audit-generated' }
    : { kind, paragraphId: 'audit-a', splitAt: 5, newParagraphId: 'audit-generated' } });
  const move = createParagraphStructureSuggestion(round, { author: 'Reviewer', operation: { kind: 'move-paragraph', paragraphId: 'audit-a', destinationId: 'audit-b', placement: 'after' } });
  await submitReviewSuggestion(introduction);await submitReviewSuggestion(move);
  expect((await decideReviewSuggestion(round.id, introduction.id, 'accepted')).status).toBe('committed');
  const introduced = structuredClone(getSerializedSession());
  await startReviewRound('Retained generated identity baseline');
  expect(await db.idbSetSnapshots(round.ownerDocumentId!, [{ ts: introduced.timestamp, session: introduced }])).toBe(true);
  expect((await decideReviewSuggestion(round.id, move.id, 'accepted')).status).toBe('committed');
  const moved = structuredClone(getSerializedSession());
  expect(moved.paragraphs.map(node => node.id)).toEqual(['audit-generated', 'audit-b', 'audit-a']);
  expect((await saved(round.ownerDocumentId!)).session.reviewComments).toEqual(introduced.reviewComments);
  for (const expected of [introduced, original]) {
    expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
    expect((await saved(round.ownerDocumentId!)).session.paragraphs).toEqual(expected.paragraphs);
    expect((await saved(round.ownerDocumentId!)).session.reviewComments).toEqual(expected.reviewComments);
  }
  expect((await decideReviewSuggestion(round.id, introduction.id, 'accepted')).status).toBe('committed');
  expect((await decideReviewSuggestion(round.id, move.id, 'accepted')).status).toBe('committed');
  expect((await saved(round.ownerDocumentId!)).session.paragraphs).toEqual(moved.paragraphs);
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
  expect(getSerializedSession().paragraphs).toEqual(introduced.paragraphs);
  expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');await flushDocumentWrites();
  expect((await saved(round.ownerDocumentId!)).session.paragraphs).toEqual(moved.paragraphs);
  const persisted = await saved(round.ownerDocumentId!);
  useDocumentsStore.setState({ docs: { [persisted.id]: { meta: persisted.meta, session: persisted.session } }, trash: {}, currentId: null, baseline: null });
  expect(openExistingDocument(persisted.id)).toBe('applied');
  expect(getSerializedSession().paragraphs).toEqual(moved.paragraphs);
  const workspace = await loadReviewSuggestionWorkspace(round.id);
  expect(validateReviewSuggestionState(round, workspace.state)).toEqual(workspace.state);
  const backup = await buildBackup();await clearDurable();
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, baseline: null });
  expect((await restoreBackup(backup)).issues).toBeUndefined();
  expect((await saved(persisted.id)).session.paragraphs).toEqual(moved.paragraphs);
  expect((await saved(persisted.id)).session.reviewComments).toEqual(moved.reviewComments);
  const restored = reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(persisted.id, round.id));
  expect(validateReviewSuggestionState(round, restored.state)).toEqual(workspace.state);
});

it('rejects future captures and duplicate introductions instead of borrowing generated identity ownership', async () => {
  const round = await startReviewRound('Future decision defenses');
  const insertion = createParagraphStructureSuggestion(round, { author: 'Reviewer', operation: { kind: 'insert-paragraph', index: 1, text: 'Generated sibling.', level: 0, paragraphId: 'audit-generated' } });
  const move = createParagraphStructureSuggestion(round, { author: 'Reviewer', operation: { kind: 'move-paragraph', paragraphId: 'audit-a', destinationId: 'audit-b', placement: 'after' } });
  let state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [insertion, move]);
  const introduced = planReviewSuggestionDecision(round, getSerializedSession(), state, insertion.id, 'accepted');
  const moved = planReviewSuggestionDecision(round, introduced.session, introduced.state, move.id, 'accepted');
  const future = structuredClone(moved.state);future.decisions.reverse();
  expect(() => validateReviewSuggestionState(round, future)).toThrow(/reuse a new paragraph identity/);
  const duplicate = createParagraphStructureSuggestion(round, { author: 'Reviewer', operation: { kind: 'insert-paragraph', index: 0, text: 'Other generated content.', level: 0, paragraphId: 'audit-generated' } });
  for (const decisions of [moved.state.decisions, []]) {
    const forged = { ...structuredClone(moved.state), decisions: structuredClone(decisions), proposals: [duplicate, ...moved.state.proposals] };
    expect(() => validateReviewSuggestionState(round, forged)).toThrow(/reuse a new paragraph identity/);
  }
  await submitReviewSuggestion(insertion);await submitReviewSuggestion(move);
  const before = await saved(round.ownerDocumentId!);
  state = reviewSuggestionRecordSchema.parse(await db.idbReadReviewSuggestions(before.id, round.id)).state;
  const accepted = planReviewSuggestionDecision(round, before.session, state, insertion.id, 'accepted');
  const forgedAfter = planReviewSuggestionDecision(round, accepted.session, accepted.state, move.id, 'accepted');
  const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: before.id,
    createdAt: Date.now(), round: { id: round.id, baselineDigest: round.baselineDigest }, before: state, after: forgedAfter.state,
    intent: { kind: 'decide', proposalId: insertion.id, action: 'accepted', record: { id: accepted.state.decisions[0].id, decidedAt: accepted.state.decisions[0].decidedAt } } };
  const after = { ...structuredClone(before), meta: { ...before.meta, updatedAt: before.meta.updatedAt + 1, nativeReviewText: true as const }, session: forgedAfter.session };
  expect(await db.idbApplyReviewSuggestions(before, after, operation)).not.toBe('committed');
  expect(await saved(before.id)).toEqual(before);
  expect(await db.idbReadReviewSuggestionReceipt(operation.id)).toBeNull();
});

it.each(['paragraph', 'discussion'] as const)('keeps a current %s collision authoritative during own reacceptance', async collision => {
  const round = await startReviewRound('Current collision defenses');
  const insertion = createParagraphStructureSuggestion(round, { author: 'Reviewer', operation: { kind: 'insert-paragraph', index: 1, text: 'Generated sibling.', level: 0, paragraphId: 'audit-generated' } });
  const move = createParagraphStructureSuggestion(round, { author: 'Reviewer', operation: { kind: 'move-paragraph', paragraphId: 'audit-a', destinationId: 'audit-b', placement: 'after' } });
  await submitReviewSuggestion(insertion);await submitReviewSuggestion(move);
  await decideReviewSuggestion(round.id, insertion.id, 'accepted');await decideReviewSuggestion(round.id, move.id, 'accepted');
  for (let count = 0; count < 2; count++) { expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');await flushDocumentWrites(); }
  if (collision === 'paragraph') useDocumentStore.setState(state => ({ paragraphs: [...state.paragraphs, { id: 'audit-generated', text: 'Different current native node.', level: 0 }] }));
  else useDocumentStore.setState(state => ({ reviewComments: { version: 3, threads: [...state.reviewComments!.threads, { id: crypto.randomUUID(),
    anchor: { kind: 'paragraph', paragraphId: 'audit-generated', context: 'Later detached discussion context.', docType: 'naval_letter' }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Synthetic reviewer', text: 'Keep this later discussion identity.', createdAt: '2026-11-15T00:00:00Z' }] }] } }));
  await commitCurrentDocument();const before = await saved(round.ownerDocumentId!);
  await expect(decideReviewSuggestion(round.id, insertion.id, 'accepted')).rejects.toThrow(/target differs/);
  expect(await saved(before.id)).toEqual(before);
  expect((await loadReviewSuggestionWorkspace(round.id)).state!.decisions.map(decision => decision.action)).toEqual(['accepted', 'accepted', 'reversed', 'reversed']);
});

it('keeps reservations local to the source while refusing another round on that same source', async () => {
  const round = await startReviewRound('Current source');
  const before = await saved(round.ownerDocumentId!);
  const foreignId = crypto.randomUUID();
  const foreignDocument = { ...structuredClone(before), id: foreignId, meta: { ...before.meta, id: foreignId } };
  const foreign = parseReviewRound({ ...structuredClone(round), id: `review_${crypto.randomUUID()}`, sourceDocumentId: foreignId, ownerDocumentId: foreignId });
  const introduction = (target: typeof round) => createParagraphStructureSuggestion(target, { author: 'Reviewer', operation: { kind: 'insert-paragraph', index: 1, text: 'Reserved separately per source.', level: 0, paragraphId: 'shared-across-owners' } });
  const foreignProposal = introduction(foreign);
  await db.idbPutDocument(foreignDocument);expect(await db.idbAddReviewRound(foreign)).toBe('committed');
  expect(await db.idbRestoreReviewSuggestions([{ documentId: foreignId, state: appendReviewSuggestions(foreign, emptyReviewSuggestionState(foreign), [foreignProposal]) }], [], [foreignDocument])).toBe(true);
  expect((await submitReviewSuggestion(introduction(round))).status).toBe('committed');
  expect((await db.idbReadAllReviewSuggestions(before.id)).length).toBe(1);
  expect((await db.idbReadAllReviewSuggestions(foreignId)).length).toBe(1);
  const later = await startReviewRound('Different round of the current source');
  await expect(submitReviewSuggestion(introduction(later))).rejects.toThrow(/reserved/);
  expect(await db.idbReadReviewSuggestions(before.id, later.id)).toBeNull();
  expect((await saved(before.id)).session.paragraphs).toEqual(before.session.paragraphs);
});
