import { describe, expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { captureTextRange } from '@/lib/reviewTextRanges';
import { reconcileReviewRange } from '@/lib/reconcileReviewText';
import { appendReviewSuggestions, createSelectedTextSuggestion, emptyReviewSuggestionState, inspectReviewSuggestion,
  planReviewSuggestionDecision, planReviewSuggestionHistory, validateReviewSuggestionState } from '@/lib/reviewSuggestions';
import { planReviewSuggestionWrite, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import { createSuggestionReviewReturn, parseReviewReturn } from '@/lib/reviewReturns';

function fixture(text = 'Start red middle blue ending.') {
  const source = createBlankSession();source.paragraphs = [{ id: 'body', text, level: 0 }, { id: 'other', text: 'Other current work.', level: 0 }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 1,
    label: 'Synthetic scope review', sourceDocumentId: 'owner', ownerDocumentId: 'owner', baselineDigest: 'a'.repeat(64),
    baseline: { ts: 1, session: structuredClone(source) } };
  const make = (start: number, end: number, proposed: string, author = 'Reviewer One') => createSelectedTextSuggestion(round, { paragraphId: 'body', start, end, proposed, author });
  return { source, round, make };
}
const record = () => ({ id: crypto.randomUUID(), decidedAt: 2 });

describe('range-aware review reconciliation', () => {
  it('preserves multiple independent hunks, Unicode, another field and a paragraph move', () => {
    const input = fixture('First 👩🏽‍✈️ Équipe middle 日本語 ending.');
    const start = input.source.paragraphs[0].text.indexOf('Équipe');
    const proposal = input.make(start, start + 'Équipe'.length, 'équipe');
    input.source.paragraphs[0].text = 'Newest 👩🏽‍✈️ Équipe middle 日本語 finished.';
    input.source.formData.subject = 'Newer author subject';input.source.paragraphs.reverse();
    const state = appendReviewSuggestions(input.round, emptyReviewSuggestionState(input.round), [proposal]);
    const plan = planReviewSuggestionDecision(input.round, input.source, state, proposal.id, 'accepted');
    expect(plan.status).toBe('ready');expect(plan.session.paragraphs[1].text).toBe('Newest 👩🏽‍✈️ équipe middle 日本語 finished.');
    expect(plan.session.formData.subject).toBe('Newer author subject');expect(plan.session.paragraphs[0]).toEqual(input.source.paragraphs[0]);
    expect(plan.state.decisions[0].resolutions?.[0]).toMatchObject({ expectedCurrent: 'Équipe', range: { context: input.source.paragraphs[1].text } });
    expect(input.round.baseline.session.paragraphs[0].text).toBe('First 👩🏽‍✈️ Équipe middle 日本語 ending.');
  });

  it('accepts two separated reviewer spans in either order without an arrival-order overlap winner', () => {
    const { round, source, make } = fixture();
    const red = make(6, 9, 'scarlet'), blue = make(17, 21, 'azure', 'Reviewer Two');
    for (const proposals of [[red, blue], [blue, red]]) {
      let state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), proposals), session = structuredClone(source);
      for (const proposal of proposals) {
        const plan = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
        expect(plan.status).toBe('ready');state = plan.state;session = plan.session;
      }
      expect(session.paragraphs[0].text).toBe('Start scarlet middle azure ending.');expect(state.decisions).toHaveLength(2);
      expect(new Set(state.proposals.map(proposal => proposal.author))).toEqual(new Set(['Reviewer One', 'Reviewer Two']));
    }
    const rival = make(6, 9, 'crimson', 'Reviewer Two');
    for (const proposals of [[red, rival], [rival, red]]) {
      const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), proposals);
      const first = planReviewSuggestionDecision(round, source, state, proposals[0].id, 'accepted');
      const second = planReviewSuggestionDecision(round, first.session, first.state, proposals[1].id, 'accepted');
      expect(second.status).toBe('stale');expect(second.state.decisions).toHaveLength(1);expect(second.session).toEqual(first.session);
    }
  });

  it('surfaces overlap, deletion versus edit, caret boundaries and repeated-text ambiguity', () => {
    for (const [text, start, end, current, expected] of [
      ['abcde', 1, 4, 'abXde', 'overlap'], ['abcde', 1, 4, 'ae', 'overlap'],
      ['abcde', 2, 2, 'abXcde', 'ambiguous'], ['Alpha Alpha end.', 0, 5, 'Alpha end.', 'ambiguous'],
    ] as const) expect(reconcileReviewRange({ context: text, start, end }, current).kind).toBe(expected);
    const input = fixture('Alpha Alpha end.'), proposal = input.make(0, 5, 'Bravo');
    input.source.paragraphs[0].text = 'Alpha end.';
    const state = appendReviewSuggestions(input.round, emptyReviewSuggestionState(input.round), [proposal]);
    expect(inspectReviewSuggestion(input.round, input.source, proposal)[0].reconciliation?.kind).toBe('ambiguous');
    expect(planReviewSuggestionDecision(input.round, input.source, state, proposal.id, 'accepted').status).toBe('stale');
    const scope = { context: 'Alpha end.', start: 0, end: 5 };
    for (const value of ['Alpha', 'Bravo', 'Deliberate combined']) {
      const resolution = { changeId: proposal.changes[0].id, expectedCurrent: 'Alpha', value, range: scope };
      const plan = planReviewSuggestionDecision(input.round, input.source, state, proposal.id, 'accepted', undefined, [resolution]);
      expect(plan.status).toBe('ready');expect(plan.session.paragraphs[0].text).toBe(`${value} end.`);
      expect(plan.state.decisions[0].resolutions).toEqual([resolution]);
    }
  });

  it('uses deliberate caret scope to resolve selected text deleted by the current author', () => {
    const input = fixture('Start red ending.'), proposal = input.make(6, 9, 'scarlet');input.source.paragraphs[0].text = 'Start  ending.';
    const state = appendReviewSuggestions(input.round, emptyReviewSuggestionState(input.round), [proposal]);
    const plan = planReviewSuggestionDecision(input.round, input.source, state, proposal.id, 'accepted', undefined,
      [{ changeId: proposal.changes[0].id, expectedCurrent: '', value: 'scarlet', range: { context: 'Start  ending.', start: 6, end: 6 } }]);
    expect(plan.status).toBe('ready');expect(plan.session.paragraphs[0].text).toBe('Start scarlet ending.');
  });

  it('bounds complex alignment work and requires explicit manual scope rather than guessing', () => {
    const context = 'x'.repeat(2_000), current = 'y' + context;
    expect(reconcileReviewRange({ context, start: 900, end: 950 }, current)).toEqual({ kind: 'ambiguous', currentContext: current });
  });

  it('guards full captured context in queued writes and rejects malformed or mismatched scopes', () => {
    const { source, round, make } = fixture(), proposal = make(6, 9, 'scarlet');source.paragraphs[0].text = 'Start RED middle blue ending.';
    const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
    const resolution = { changeId: proposal.changes[0].id, expectedCurrent: 'RED', value: 'combined', range: { context: source.paragraphs[0].text, start: 6, end: 9 } };
    const plan = planReviewSuggestionDecision(round, source, state, proposal.id, 'accepted', undefined, [resolution]);
    const decision = plan.state.decisions[0];
    const write: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: 'owner', createdAt: 2,
      round: { id: round.id, baselineDigest: round.baselineDigest }, before: state, after: plan.state,
      intent: { kind: 'decide', proposalId: proposal.id, action: 'accepted', record: { id: decision.id, decidedAt: decision.decidedAt }, resolutions: [resolution] } };
    expect(planReviewSuggestionWrite(round, source, write).session.paragraphs[0].text).toBe('Start combined middle blue ending.');
    const late = structuredClone(source);late.paragraphs[0].text += ' Unrelated later work.';
    expect(() => planReviewSuggestionWrite(round, late, write)).toThrow(/changed/);
    expect(late.paragraphs[0].text).toBe('Start RED middle blue ending. Unrelated later work.');
    for (const range of [{ ...resolution.range, start: -1 }, { ...resolution.range, end: 100 }, { ...resolution.range, context: 'Forged RED context' }]) {
      expect(() => planReviewSuggestionDecision(round, source, state, proposal.id, 'accepted', undefined, [{ ...resolution, range }])).toThrow();
    }
    const split = { ...resolution, expectedCurrent: '👩', range: { context: '👩🏽‍✈️', start: 0, end: 2 } };
    expect(() => planReviewSuggestionDecision(round, source, state, proposal.id, 'accepted', undefined, [split])).toThrow();
    expect(() => planReviewSuggestionDecision(round, source, state, proposal.id, 'rejected', undefined, [resolution])).toThrow();
  });

  it('retains scoped decisions through returns, reload and precise Undo/Redo with unrelated newer work', () => {
    const { source, round, make } = fixture(), proposal = make(6, 9, 'scarlet');
    const returned = parseReviewReturn(JSON.parse(JSON.stringify(createSuggestionReviewReturn(round.id, round.baselineDigest, undefined, [proposal], { marking: 'UNCLASSIFIED', customMarkings: [] }))));
    if (returned.version !== 2) throw new Error('Expected proposals');
    let state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), returned.proposals!);
    expect(appendReviewSuggestions(round, state, returned.proposals!)).toEqual(state);
    source.paragraphs[0].text = 'Newest red middle blue completed.';
    const accepted = planReviewSuggestionDecision(round, source, state, proposal.id, 'accepted');
    state = validateReviewSuggestionState(round, JSON.parse(JSON.stringify(accepted.state)));
    const current = structuredClone(accepted.session);current.paragraphs[0].text += ' Later.';current.formData.subject = 'Later subject';
    const undone = structuredClone(current);undone.paragraphs[0].text = 'Newest red middle blue completed. Later.';
    const id = state.decisions[0].id;
    const history = (before: typeof source, after: typeof source, direction: 'undo' | 'redo') => {
      const event = record(), nextState = planReviewSuggestionHistory(round, before, after, state, id, direction, event);
      const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: 'owner', createdAt: 3,
        round: { id: round.id, baselineDigest: round.baselineDigest }, before: state, after: nextState,
        intent: { kind: 'history', acceptanceId: id, direction, record: event } };
      const plan = planReviewSuggestionWrite(round, before, operation, after);state = plan.state;return plan.session;
    };
    expect(history(current, undone, 'undo')).toEqual(undone);
    expect(history(undone, current, 'redo')).toEqual(current);
    expect(state.decisions.map(item => item.action)).toEqual(['accepted', 'reversed', 'restored']);
  });

  it('preserves outside discussions and safely restores touched range discussions through a manual resolution history', () => {
    const { source, round, make } = fixture(), proposal = make(6, 9, 'scarlet');source.paragraphs[0].text = 'Start RED middle blue ending.';
    source.reviewComments = { version: 3, threads: [[6, 9], [17, 21]].map(([start, end]) => ({ id: crypto.randomUUID(),
      anchor: captureTextRange(source, 'body', start, end)!, resolved: false,
      messages: [{ id: crypto.randomUUID(), author: 'Author', text: 'Retained discussion.', createdAt: '2026-11-15T00:00:00.000Z' }] })) };
    const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
    const resolution = { changeId: proposal.changes[0].id, expectedCurrent: 'RED', value: 'scarlet',
      range: { context: source.paragraphs[0].text, start: 6, end: 9 } };
    const accepted = planReviewSuggestionDecision(round, source, state, proposal.id, 'accepted', undefined, [resolution]);
    expect(accepted.session.reviewComments!.threads[0].anchor).toHaveProperty('detached', true);
    expect(accepted.session.reviewComments!.threads[1].anchor).toHaveProperty('tracking.start', 21);
    const acceptanceId = accepted.state.decisions[0].id;
    let historyState = accepted.state;
    for (const direction of ['undo', 'redo'] as const) {
      const before = direction === 'undo' ? accepted.session : source, after = direction === 'undo' ? source : accepted.session;
      const event = record(), next = planReviewSuggestionHistory(round, before, after, historyState, acceptanceId, direction, event);
      const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: 'owner', createdAt: 3,
        round: { id: round.id, baselineDigest: round.baselineDigest }, before: historyState, after: next,
        intent: { kind: 'history', acceptanceId, direction, record: event } };
      expect(planReviewSuggestionWrite(round, before, operation, after).session).toEqual(after);historyState = next;
    }
  });

  it('counts every retained resolution context against the existing aggregate budget', () => {
    const { source, round, make } = fixture(), proposal = make(6, 9, 'scarlet');
    const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
    const accepted = planReviewSuggestionDecision(round, source, state, proposal.id, 'accepted');
    const oversized = structuredClone(accepted.state);const decision = oversized.decisions[0];
    for (let index = 0; index < 12; index++) {
      {
        const reverse = { ...record(), proposalId: proposal.id, roundId: round.id, baselineDigest: round.baselineDigest,
          action: 'reversed' as const, previousDecisionId: oversized.decisions.at(-1)!.id, acceptanceId: oversized.decisions.at(-1)!.id };
        oversized.decisions.push(reverse);
      }
      const context = 'red' + 'x'.repeat(19_000);
      oversized.decisions.push({ ...decision, ...record(), previousDecisionId: oversized.decisions.at(-1)!.id,
        resolutions: [{ changeId: proposal.changes[0].id, expectedCurrent: 'red', value: 'scarlet', range: { context, start: 0, end: 3 } }] });
    }
    expect(() => validateReviewSuggestionState(round, oversized)).toThrow(/supported text limit/);
  });
});
