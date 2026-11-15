import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { captureReviewDecisionSummary, prepareReviewDecisionSummary, renderReviewDecisionSummary, reviewDecisionSummaryDetails, downloadReviewDecisionSummary } from '@/lib/reviewDecisionSummary';
import { createReviewSuggestion, planReviewSuggestionDecision, planReviewSuggestionHistory } from '@/lib/reviewSuggestions';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { decisionSummaryFixture } from '../_helpers/decisionSummaryFixture';

const when = '2026-11-15T05:00:00.000Z';
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
afterEach(() => vi.restoreAllMocks());

it('counts grouped proposals once and separates accepted rejected open and conflicting items', async () => {
  const input = decisionSummaryFixture();
  const group = createReviewSuggestion(input.round, { author: 'Group reviewer', label: 'Two corrections', origin: { kind: 'mechanical', rule: 'fixture' }, changes: [
    { target: { kind: 'field', field: 'to', docType: 'naval_letter' }, proposed: 'New recipient' },
    { target: { kind: 'paragraph', paragraphId: 'first', docType: 'naval_letter' }, proposed: 'New body' },
  ] });
  const rejected = createReviewSuggestion(input.round, { author: 'Reviewer', label: 'Rejected sender', changes: [{ target: { kind: 'field', field: 'from', docType: 'naval_letter' }, proposed: 'Other sender' }] });
  const open = createReviewSuggestion(input.round, { author: 'Reviewer', label: 'Open subject', category: 'question', changes: [{ target: { kind: 'field', field: 'subject', docType: 'naval_letter' }, proposed: 'OTHER SUBJECT' }] });
  const conflict = createReviewSuggestion(input.round, { author: 'Reviewer', label: 'Body conflict', changes: [{ target: { kind: 'paragraph', paragraphId: 'second', docType: 'naval_letter' }, proposed: 'Other body' }] });
  input.state!.proposals = [group, rejected, open, conflict];
  const accepted = planReviewSuggestionDecision(input.round, input.current, input.state!, group.id, 'accepted');
  const denied = planReviewSuggestionDecision(input.round, accepted.session, accepted.state, rejected.id, 'rejected');
  input.state = denied.state;input.current = denied.session;input.current.paragraphs[1].text = 'Independent author edit';
  const prepared = prepareReviewDecisionSummary(await captureReviewDecisionSummary(input, when), policy);
  expect(reviewDecisionSummaryDetails(prepared).counts).toEqual({ accepted: 1, rejected: 1, open: 1, conflicting: 1 });
  const html = renderReviewDecisionSummary(prepared);
  expect(html).toContain('Each suggested-edit group counts once');
  expect(html).toContain('Independent author edit');expect(html).toContain('Feedback category: Question');
  expect(html).toContain('Accepted result at decision');expect(html).toContain('New recipient');
});

it('retains acceptance resolutions through undo redo and later independent text changes', async () => {
  const input = decisionSummaryFixture();const proposal = input.state!.proposals[0];
  input.current.formData.to = 'Independent recipient';
  const preAcceptance = structuredClone(input.current);
  const accepted = planReviewSuggestionDecision(input.round, input.current, input.state!, proposal.id, 'accepted', undefined,
    [{ changeId: proposal.changes[0].id, expectedCurrent: 'Independent recipient', value: 'Combined recipient' }]);
  input.state = accepted.state;input.current = accepted.session;
  const acceptedState = structuredClone(accepted.state);
  const undone = planReviewSuggestionHistory(input.round, accepted.session, preAcceptance, accepted.state, accepted.state.decisions[0].id, 'undo');
  input.state = undone;input.current = structuredClone(preAcceptance);
  expect(reviewDecisionSummaryDetails(prepareReviewDecisionSummary(await captureReviewDecisionSummary(input, when), policy)).counts.conflicting).toBe(1);
  input.state = planReviewSuggestionHistory(input.round, input.current, accepted.session, undone, acceptedState.decisions[0].id, 'redo');
  input.current = structuredClone(accepted.session);input.current.formData.to = 'Later current recipient';
  const prepared = prepareReviewDecisionSummary(await captureReviewDecisionSummary(input, when), policy);
  expect(reviewDecisionSummaryDetails(prepared).counts.accepted).toBe(1);
  const html = renderReviewDecisionSummary(prepared);
  expect(html).toContain('Accepted earlier; current draft text has changed');
  for (const text of ['Combined recipient', 'Independent recipient', 'Later current recipient', 'reversed', 'restored']) expect(html).toContain(text);
});

it('owns the capture before awaiting and excludes caller mutation and later round changes', async () => {
  const input = decisionSummaryFixture();
  const pending = captureReviewDecisionSummary(input, when);
  input.state!.proposals[0].changes[0].proposed = 'LATE PROPOSAL';
  input.current.formData.to = 'LATE CURRENT';input.round.label = 'LATE ROUND';
  const prepared = prepareReviewDecisionSummary(await pending, policy);
  const details = reviewDecisionSummaryDetails(prepared);details.counts.open = 99;details.marking = 'CHANGED';
  const html = renderReviewDecisionSummary(prepared);
  expect(html).toContain('Proposed recipient');expect(html).toContain('Original recipient');
  expect(html).not.toContain('LATE');expect(html).not.toContain('CHANGED');
  expect(reviewDecisionSummaryDetails(prepared).counts.open).toBe(1);
});

it('escapes HTML in proposals reviewer labels and complete retained discussion context', async () => {
  const input = decisionSummaryFixture();
  input.state!.proposals[0].author = '<img src=x onerror=alert(1)>';
  input.state!.proposals[0].changes[0].proposed = '<script>proposal()</script>';
  input.current.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), category: 'question', anchor: { kind: 'field', field: 'to', context: '<script>old()</script>', docType: 'naval_letter' }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: '<b>Reviewer</b>', text: 'A & B <script>discussion()</script>', createdAt: when }] }] };
  const prepared = prepareReviewDecisionSummary(await captureReviewDecisionSummary(input, when), policy);
  const html = renderReviewDecisionSummary(prepared);
  expect(html).not.toContain('<script>');expect(html).not.toContain('<img');
  expect(html).toContain('&lt;script&gt;discussion()');expect(html).toContain('&lt;script&gt;old()');expect(html).toContain('A &amp; B');
  expect(html).toContain('Current discussions: 1 open, 0 resolved');
});

it('checks rejected text and historic manual resolutions against handling policy and privacy patterns', async () => {
  const input = decisionSummaryFixture();const proposal = input.state!.proposals[0];
  proposal.changes[0].proposed = '(S) Retained secret text\nSSN 123-45-6789';
  const rejected = planReviewSuggestionDecision(input.round, input.current, input.state!, proposal.id, 'rejected');input.state = rejected.state;
  const capture = await captureReviewDecisionSummary(input, when);
  expect(() => prepareReviewDecisionSummary(capture, policy)).toThrow('outside this deployment');
  const high = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: { maxLevel: 'secret', allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'] }, runtime: { status: 'absent' } });
  const prepared = prepareReviewDecisionSummary(capture, high);
  expect(reviewDecisionSummaryDetails(prepared).privacy.findings.some(finding => finding.value === '123-45-6789')).toBe(true);
  expect(() => downloadReviewDecisionSummary(prepared, policy)).toThrow('outside this deployment');
});

it('refuses unreadable comments instead of silently omitting discussion content', async () => {
  const input = decisionSummaryFixture();input.current.reviewComments = { version: 99, threads: [] } as never;
  await expect(captureReviewDecisionSummary(input, when)).rejects.toThrow();
});

it('keeps multiline markings and private values in reversed manual-resolution history within the policy gate', async () => {
  const input = decisionSummaryFixture();const proposal = input.state!.proposals[0];
  const original = structuredClone(input.current);
  const accepted = planReviewSuggestionDecision(input.round, input.current, input.state!, proposal.id, 'accepted', undefined,
    [{ changeId: proposal.changes[0].id, expectedCurrent: 'Original recipient', value: 'Historic resolution\n(S) Retained restricted text\n123-45-6789' }]);
  input.state = planReviewSuggestionHistory(input.round, accepted.session, original, accepted.state, accepted.state.decisions[0].id, 'undo');
  const captured = await captureReviewDecisionSummary(input, when);
  expect(() => prepareReviewDecisionSummary(captured, policy)).toThrow('outside this deployment');
});

it('flushes pending writes before reading review state and refuses an activation switch during the flush', async () => {
  const documents = await import('@/stores/documentsStore');
  const actions = await import('@/lib/reviewSuggestionActions');
  const { loadReviewDecisionSummary } = await import('@/lib/reviewDecisionSummary');
  const input = decisionSummaryFixture();
  let finish!: () => void;
  vi.spyOn(documents, 'flushDocumentWrites').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const load = vi.spyOn(actions, 'loadReviewSuggestionWorkspace').mockResolvedValue(input);
  const pending = loadReviewDecisionSummary(input.round.id);
  expect(load).not.toHaveBeenCalled();
  finish();await pending;
  expect(load).toHaveBeenCalledOnce();
  load.mockClear();
  const switched = loadReviewDecisionSummary(input.round.id);
  documents.useDocumentsStore.getState().newDocument();finish();
  await expect(switched).rejects.toThrow('active draft changed');
  expect(load).not.toHaveBeenCalled();
});

it('does not infer acceptance from matching proposal text and can summarize a closed round', async () => {
  const input = decisionSummaryFixture();input.current.formData.to = 'Proposed recipient';
  input.round.lifecycle = { events: [{ id: crypto.randomUUID(), state: 'closed', changedAt: 2 }] };
  const prepared = prepareReviewDecisionSummary(await captureReviewDecisionSummary(input, when), policy);
  expect(reviewDecisionSummaryDetails(prepared).counts).toEqual({ accepted: 0, rejected: 0, open: 0, conflicting: 1 });
  const html = renderReviewDecisionSummary(prepared);
  expect(html).toContain('Round status at capture: closed');
  expect(html).toContain('matching proposed value without a recorded decision remains undecided');
});
