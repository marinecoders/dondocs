import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { decisionSummaryFixture } from '../_helpers/decisionSummaryFixture';
import { createReviewSuggestion, planReviewSuggestionDecision } from '@/lib/reviewSuggestions';
import { captureReviewDecisionSummary, prepareReviewDecisionSummary, renderReviewDecisionSummary,
  reviewDecisionSummaryDetails } from '@/lib/reviewDecisionSummary';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

const capturedAt = '2026-11-15T06:00:00.000Z';
const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });

it('retains a deleted target and its exact proposal as a conflict instead of omitting it', async () => {
  const input = decisionSummaryFixture();
  const proposal = createReviewSuggestion(input.round, { author: 'Example chief', label: 'Missing paragraph', changes: [
    { target: { kind: 'paragraph', paragraphId: 'first', docType: 'naval_letter' }, proposed: 'Retained proposed wording.' },
  ] });
  input.state!.proposals = [proposal];
  input.current.paragraphs = input.current.paragraphs.filter(paragraph => paragraph.id !== 'first');
  const prepared = prepareReviewDecisionSummary(await captureReviewDecisionSummary(input, capturedAt), policy);
  expect(reviewDecisionSummaryDetails(prepared).counts).toEqual({ accepted: 0, rejected: 0, open: 0, conflicting: 1 });
  const html = renderReviewDecisionSummary(prepared);
  expect(html).toContain('Target unavailable');
  expect(html).toContain('First body.');
  expect(html).toContain('Retained proposed wording.');
  expect(input.current.paragraphs).toHaveLength(1);
});

it('does not change a rejected decision when current text later happens to match the proposal', async () => {
  const input = decisionSummaryFixture();
  const proposal = input.state!.proposals[0];
  const rejected = planReviewSuggestionDecision(input.round, input.current, input.state!, proposal.id, 'rejected');
  input.state = rejected.state;
  input.current = rejected.session;
  input.current.formData.to = proposal.changes[0].proposed;
  const prepared = prepareReviewDecisionSummary(await captureReviewDecisionSummary(input, capturedAt), policy);
  expect(reviewDecisionSummaryDetails(prepared).counts).toEqual({ accepted: 0, rejected: 1, open: 0, conflicting: 0 });
  expect(renderReviewDecisionSummary(prepared)).toContain('Status: rejected');
  expect(input.state.decisions).toHaveLength(1);
  expect(input.state.decisions[0].action).toBe('rejected');
});

it('preserves the handling floor of a higher-marked baseline after the current draft is lowered', async () => {
  const input = decisionSummaryFixture();
  input.round.baseline.session.formData.classLevel = 'secret';
  input.current.formData.classLevel = 'unclassified';
  const capture = await captureReviewDecisionSummary(input, capturedAt);
  expect(() => prepareReviewDecisionSummary(capture, policy)).toThrow(/configured levels/);
  const allowed = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: {
    maxLevel: 'secret', allowedLevels: ['unclassified', 'cui', 'confidential', 'secret'],
  }, runtime: { status: 'absent' } });
  const prepared = prepareReviewDecisionSummary(capture, allowed);
  expect(reviewDecisionSummaryDetails(prepared).marking).toBe('SECRET');
  expect(input.current.formData.classLevel).toBe('unclassified');
});

it('exports discussion-only rounds without inventing decisions or double-counting thread versions', async () => {
  const input = decisionSummaryFixture();
  input.state!.proposals = [];
  input.current.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: true,
    messages: [{ id: crypto.randomUUID(), author: 'Example chief', text: 'Completed discussion without a proposed edit.', createdAt: capturedAt }] }] };
  input.round.baseline.session.reviewComments = structuredClone(input.current.reviewComments);
  input.round.baseline.session.reviewComments.threads[0].resolved = false;
  const prepared = prepareReviewDecisionSummary(await captureReviewDecisionSummary(input, capturedAt), policy);
  expect(reviewDecisionSummaryDetails(prepared).counts).toEqual({ accepted: 0, rejected: 0, open: 0, conflicting: 0 });
  const html = renderReviewDecisionSummary(prepared);
  expect(html).toContain('No suggested edits retained for this round.');
  expect(html).toContain('Baseline discussions: 1 open, 0 resolved. Current discussions: 0 open, 1 resolved.');
  expect(html).toContain('Completed discussion without a proposed edit.');
});
