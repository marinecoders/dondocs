import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import * as reconciliation from '@/lib/reconcileReviewText';
import { appendReviewSuggestions, createSelectedTextSuggestion, emptyReviewSuggestionState, inspectReviewSuggestion, inspectReviewSuggestionBatch,
  planReviewSuggestionDecision } from '@/lib/reviewSuggestions';

// Compare alignment correctness with equal time budgets. A scheduler pause can
// expire an uncached call while the batch legitimately reuses an earlier result.
beforeEach(() => { vi.spyOn(performance, 'now').mockReturnValue(0); });
afterEach(() => { vi.restoreAllMocks(); });

function fixture(text: string) {
  const source = createBlankSession();source.paragraphs = [{ id: 'body', text, level: 0 }, { id: 'other', text, level: 0 }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 1,
    label: 'Synthetic batch', sourceDocumentId: 'owner', ownerDocumentId: 'owner', baselineDigest: 'a'.repeat(64),
    baseline: { ts: 1, session: structuredClone(source) } };
  const make = (start: number, end: number, paragraphId = 'body') => createSelectedTextSuggestion(round, { paragraphId, start, end, proposed: 'Replacement', author: 'Reviewer' });
  return { source, round, make };
}

it('matches uncached inspection for distinct scopes, repeated selections, Unicode and accepted resolutions', () => {
  for (const [text, current, scopes] of [
    ['Start red middle blue ending.', 'Newest red middle blue completed.', [[6, 9], [17, 21], [10, 10]]],
    ['Alpha Alpha end.', 'Alpha end.', [[0, 5], [6, 11], [0, 0]]],
    ['Before 👩🏽‍✈️ after é équipe.', 'Newest 👩🏽‍✈️ after é completed.', [[7, 14], [21, 23], [24, 30]]],
  ] as const) {
    const { source, round, make } = fixture(text);source.paragraphs[0].text = current;
    const proposals = [...scopes, ...scopes].map(([start, end]) => make(start, end));
    const inputs = proposals.map(proposal => ({ proposal }));
    expect(inspectReviewSuggestionBatch(round, source, inputs)).toEqual(proposals.map(proposal => inspectReviewSuggestion(round, source, proposal)));
  }
  const { source, round, make } = fixture('Alpha Alpha end.'), proposal = make(0, 5);
  source.paragraphs[0].text = 'Alpha end.';
  const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
  const accepted = planReviewSuggestionDecision(round, source, state, proposal.id, 'accepted', undefined,
    [{ changeId: proposal.changes[0].id, expectedCurrent: 'Alpha', value: 'Bravo', range: { context: 'Alpha end.', start: 0, end: 5 } }]);
  const resolutions = accepted.state.decisions[0].resolutions;
  expect(inspectReviewSuggestionBatch(round, accepted.session, [{ proposal, resolutions }, { proposal }, { proposal, resolutions }]))
    .toEqual([inspectReviewSuggestion(round, accepted.session, proposal, resolutions), inspectReviewSuggestion(round, accepted.session, proposal), inspectReviewSuggestion(round, accepted.session, proposal, resolutions)]);
});

it('keeps native target and proposal validation on hits and never shares mutable reconciliation scopes', () => {
  const { source, round, make } = fixture('Start red middle blue ending.'), first = make(6, 9), second = make(6, 9), other = make(6, 9, 'other');
  source.paragraphs.forEach(paragraph => { paragraph.text = 'Newest red middle blue completed.'; });
  const inputs = [{ proposal: first }, { proposal: second }], inspected = inspectReviewSuggestionBatch(round, source, inputs);
  expect(inspected[0][0].reconciliation?.scope).toBeDefined();
  inspected[0][0].reconciliation!.scope!.start = 0;
  inspected[0][0].reconciliation!.kind = 'ambiguous';
  expect(inspected[1][0].reconciliation).toEqual(inspectReviewSuggestion(round, source, second)[0].reconciliation);
  expect(inspectReviewSuggestionBatch(round, source, inputs)[0]).toEqual(inspectReviewSuggestion(round, source, first));

  source.paragraphs[1].header = 'Unsupported formatted target';
  const mixed = inspectReviewSuggestionBatch(round, source, [{ proposal: first }, { proposal: other }]);
  expect(mixed[0][0].reconciliation?.kind).toBe('independent');expect(mixed[1][0].reconciliation).toBeUndefined();
  for (const invalid of [
    { ...second, roundId: `review_${crypto.randomUUID()}` },
    { ...second, changes: [{ ...second.changes[0], expected: 'forged' }] },
    { ...second, changes: [{ ...second.changes[0], target: { ...second.changes[0].target, docType: 'other' } }] },
  ]) expect(() => inspectReviewSuggestionBatch(round, source, [{ proposal: first }, { proposal: invalid }])).toThrow();
  expect(() => inspectReviewSuggestionBatch(round, source, Array.from({ length: 101 }, () => ({ proposal: first })))).toThrow(/too many/);
});

it('is equivalent to individual inspections across seeded Unicode scopes and outside edits', () => {
  const parts = fc.array(fc.constantFrom('a', 'b', 'é', '👩🏽‍✈️', '日本', 'Alpha'), { minLength: 1, maxLength: 7 });
  fc.assert(fc.property(parts, fc.nat(), fc.nat(), (words, left, right) => {
    const text = `Begin ${words.join(' ')} End.`, { source, round, make } = fixture(text);
    const offsets = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].map(part => part.index).concat(text.length);
    const [start, end] = [offsets[left % offsets.length], offsets[right % offsets.length]].sort((a, b) => a - b);
    const proposals = [make(start, end), make(0, 0), make(start, end)];
    for (const current of [text, `Newer ${text} Later.`, text.replace('End.', 'Completed.')]) {
      source.paragraphs[0].text = current;
      expect(inspectReviewSuggestionBatch(round, source, proposals.map(proposal => ({ proposal }))))
        .toEqual(proposals.map(proposal => inspectReviewSuggestion(round, source, proposal)));
    }
  }), { numRuns: 100, seed: 4893026 });
});

it('keeps the alignment deadline conservative and rechecks writes after a cached inspection', () => {
  const { source, round, make } = fixture('Begin Alpha é b End.'), proposal = make(3, 5);
  source.paragraphs[0].text = 'Begin Alpha é b Completed.';
  const range = { context: round.baseline.session.paragraphs[0].text, start: 3, end: 5 }, current = source.paragraphs[0].text;
  const now = vi.mocked(performance.now);
  now.mockReturnValue(40).mockReturnValueOnce(0);
  expect(reconciliation.reconcileReviewRange(range, current)).toMatchObject({ kind: 'independent', scope: { context: current, start: 3, end: 5 } });
  now.mockReturnValue(41).mockReturnValueOnce(0);
  expect(reconciliation.reconcileReviewRange(range, current)).toEqual({ kind: 'ambiguous', currentContext: current });

  now.mockReturnValue(0);
  const inspected = inspectReviewSuggestionBatch(round, source, [{ proposal }, { proposal }]);
  expect(inspected.map(changes => changes[0].reconciliation?.kind)).toEqual(['independent', 'independent']);
  const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
  now.mockReturnValue(41).mockReturnValueOnce(0);
  const decision = planReviewSuggestionDecision(round, source, state, proposal.id, 'accepted');
  expect(decision.status).toBe('stale');expect(decision.session).toEqual(source);expect(decision.state.decisions).toHaveLength(0);
});

it('stops retaining new alignment keys when the batch character budget is exhausted', () => {
  const { source, round, make } = fixture('a'.repeat(1_900));
  const proposals = Array.from({ length: 100 }, (_, index) => make(index % 50, index % 50 + 1));
  const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), proposals);
  source.paragraphs[0].text = 'a'.repeat(19_999) + 'b';
  const align = vi.spyOn(reconciliation, 'reconcileReviewRange');
  try {
    const inspected = inspectReviewSuggestionBatch(round, source, state.proposals.map(proposal => ({ proposal })));
    expect(inspected.every(changes => changes[0].reconciliation?.kind === 'ambiguous')).toBe(true);
    const calls = align.mock.calls.filter(([, current]) => current === source.paragraphs[0].text);
    expect(calls.filter(([range]) => range.start === 0)).toHaveLength(1);
    expect(calls.filter(([range]) => range.start === 49)).toHaveLength(2);
  } finally { align.mockRestore(); }
});
