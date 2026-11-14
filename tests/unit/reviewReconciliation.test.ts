import { describe, expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { reconcileReviewText } from '@/lib/reconcileReviewText';
import { appendReviewSuggestions, createReviewSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision,
  planReviewSuggestionHistory, reviewSuggestionStateSchema } from '@/lib/reviewSuggestions';
import { planReviewSuggestionWrite, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';

function fixture() {
  const session = createBlankSession();session.formData.to = 'Training Officer';
  session.paragraphs = [{ id: 'first', text: 'Alpha team meets on Friday.', level: 0 }, { id: 'second', text: 'Other paragraph.', level: 0 }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt: 100, label: 'Training review', sourceDocumentId: 'source', ownerDocumentId: 'source', baselineDigest: 'a'.repeat(64),
    baseline: { ts: 100, session: structuredClone(session) } };
  const target = { kind: 'paragraph', paragraphId: 'first', docType: session.docType } as const;
  const proposal = createReviewSuggestion(round, { author: 'Reviewer One', label: 'Meeting day', changes: [{ target, proposed: 'Alpha team meets on Monday.' }] });
  const state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
  session.paragraphs[0].text = 'Bravo team meets on Friday.';
  const resolution = { changeId: proposal.changes[0].id, expectedCurrent: session.paragraphs[0].text, value: 'Bravo team meets on Monday.' };
  return { session, round, target, proposal, state, resolution };
}

describe('three-way native review reconciliation', () => {
  it('combines nonoverlapping scalar edits using graphemes and preserves newlines', () => {
    expect(reconcileReviewText('Alpha team meets on Friday.', 'Bravo team meets on Friday.', 'Alpha team meets on Monday.'))
      .toEqual({ kind: 'combined', value: 'Bravo team meets on Monday.' });
    expect(reconcileReviewText('👩🏽‍✈️ Équipe\nFriday 日本語', '👩🏽‍✈️ Équipe\nMonday 日本語', '👩🏽‍✈️ Équipe\nFriday 中文'))
      .toEqual({ kind: 'combined', value: '👩🏽‍✈️ Équipe\nMonday 中文' });
    expect(reconcileReviewText('abc', 'abc', '')).toEqual({ kind: 'combined', value: '' });
  });

  it('requires manual resolution for overlaps, ambiguous insertion boundaries and broad changed spans', () => {
    for (const [base, current, proposed] of [['abc', 'axc', 'ayc'], ['abc', 'aXbc', 'aYbc'],
      ['abcdef', 'abXcdef', 'abYdef'], ['one two three', 'ONE two THREE', 'one TWO three'], ['abc', '', 'axc'],
      ['👩🏽‍✈️ crew', '👩🏻‍✈️ crew', '👨🏽‍✈️ crew'], ['e\u0301 crew', 'a\u0301 crew', 'e\u0300 crew']]) {
      expect(reconcileReviewText(base, current, proposed)).toEqual({ kind: 'overlap', value: current });
    }
  });

  it('accepts a captured resolution and reverses exactly the newer draft rather than the baseline', () => {
    const { session, round, proposal, state, resolution } = fixture();
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted', undefined, [resolution]);
    expect(accepted.status).toBe('ready');expect(accepted.session.paragraphs[0].text).toBe(resolution.value);
    expect(accepted.state.version).toBe(2);expect(accepted.state.decisions[0].resolutions).toEqual([resolution]);
    const undone = planReviewSuggestionHistory(round, accepted.session, session, accepted.state, accepted.state.decisions[0].id, 'undo');
    const reloaded = reviewSuggestionStateSchema.parse(JSON.parse(JSON.stringify(undone)));
    expect(planReviewSuggestionHistory(round, session, accepted.session, reloaded, accepted.state.decisions[0].id, 'redo').decisions.map(item => item.action))
      .toEqual(['accepted', 'reversed', 'restored']);
    expect(() => planReviewSuggestionHistory(round, accepted.session, round.baseline.session, accepted.state, accepted.state.decisions[0].id, 'undo')).toThrow(/does not reverse/);
  });

  it('preserves a moved-and-edited paragraph and refuses deleted, ambiguous or structurally replaced targets', () => {
    const { session, round, proposal, state, resolution } = fixture();session.paragraphs.reverse();
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted', undefined, [resolution]);
    expect(accepted.session.paragraphs.map(item => item.id)).toEqual(['second', 'first']);
    expect(accepted.session.paragraphs[1].text).toBe(resolution.value);
    for (const change of ['delete', 'duplicate', 'table'] as const) {
      const source = structuredClone(session);
      if (change === 'delete') source.paragraphs.pop();
      if (change === 'duplicate') source.paragraphs.push({ ...source.paragraphs[1] });
      if (change === 'table') source.paragraphs[1].tableKey = 'new-table';
      const blocked = planReviewSuggestionDecision(round, source, state, proposal.id, 'accepted', undefined, [resolution]);
      expect(blocked.status).toBe('stale');expect(blocked.session).toEqual(source);expect(blocked.state.decisions).toHaveLength(0);
    }
  });

  it('rechecks captured current text at the queued write and reconstructs only the scoped resolution', () => {
    const { session, round, proposal, state, resolution } = fixture();
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted', undefined, [resolution]);
    const decision = accepted.state.decisions[0];
    const operation: ReviewSuggestionWrite = { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`,
      documentId: 'source', createdAt: 200, round: { id: round.id, baselineDigest: round.baselineDigest }, before: state, after: accepted.state,
      intent: { kind: 'decide', proposalId: proposal.id, action: 'accepted', record: { id: decision.id, decidedAt: decision.decidedAt }, resolutions: [resolution] } };
    const late = structuredClone(session);late.paragraphs[0].text += ' Later work.';
    expect(() => planReviewSuggestionWrite(round, late, operation)).toThrow(/changed/);
    const planned = planReviewSuggestionWrite(round, session, operation);
    expect(planned).toEqual({ session: accepted.session, state: accepted.state });
    const history: ReviewSuggestionWrite = { ...operation, before: accepted.state, after: planReviewSuggestionHistory(round, accepted.session, session, accepted.state, decision.id, 'undo'),
      intent: { kind: 'history', acceptanceId: decision.id, direction: 'undo', record: { id: crypto.randomUUID(), decidedAt: 300 } } };
    expect(planReviewSuggestionWrite(round, accepted.session, history, session).session.paragraphs[0].text).toBe(resolution.expectedCurrent);
  });

  it('retains separate authors and applies independent reviewer edits in either import order', () => {
    const { session, round, target, proposal } = fixture();
    const other = createReviewSuggestion(round, { author: 'Reviewer Two', label: 'Team name', changes: [{ target, proposed: 'Charlie team meets on Friday.' }] });
    for (const proposals of [[proposal, other], [other, proposal]]) {
      let state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), proposals);
      let source = structuredClone(round.baseline.session);source.formData.subject = 'NEWER AUTHOR WORK';
      for (const next of proposals) {
        const current = source.paragraphs[0].text;
        const value = reconcileReviewText(next.changes[0].expected, current, next.changes[0].proposed);
        expect(value.kind).toBe('combined');
        const result = planReviewSuggestionDecision(round, source, state, next.id, 'accepted', undefined,
          current === next.changes[0].expected ? undefined : [{ changeId: next.changes[0].id, expectedCurrent: current, value: value.value }]);
        source = result.session;state = result.state;
      }
      expect(source.paragraphs[0].text).toBe('Charlie team meets on Monday.');expect(source.formData.subject).toBe('NEWER AUTHOR WORK');
      expect(new Set(state.proposals.map(item => item.author))).toEqual(new Set(['Reviewer One', 'Reviewer Two']));
      expect(appendReviewSuggestions(round, state, proposals)).toEqual(state);
      expect(planReviewSuggestionDecision(round, source, state, proposals[0].id, 'accepted').status).toBe('decided');
    }
    expect(session.paragraphs[0].text).toBe('Bravo team meets on Friday.');
  });

  it('keeps competing replacements pending until a deliberate resolution and never chooses by arrival order', () => {
    const { round, target, proposal } = fixture();
    const other = createReviewSuggestion(round, { author: 'Reviewer Two', label: 'Different day', changes: [{ target, proposed: 'Alpha team meets on Tuesday.' }] });
    for (const proposals of [[proposal, other], [other, proposal]]) {
      const state = appendReviewSuggestions(round, emptyReviewSuggestionState(round), proposals);
      expect(state.decisions).toHaveLength(0);
      const first = planReviewSuggestionDecision(round, round.baseline.session, state, proposals[0].id, 'accepted');
      expect(planReviewSuggestionDecision(round, first.session, first.state, proposals[1].id, 'accepted').status).toBe('stale');
      expect(first.state.decisions).toHaveLength(1);
    }
  });

  it('rejects unversioned, mismatched, oversized, rejected and mechanical resolutions', () => {
    const { session, round, proposal, state, resolution } = fixture();
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted', undefined, [resolution]);
    expect(reviewSuggestionStateSchema.safeParse({ ...accepted.state, version: 1 }).success).toBe(false);
    for (const changed of [{ ...resolution, changeId: crypto.randomUUID() }, { ...resolution, value: 'x'.repeat(20_001) }])
      expect(() => planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted', undefined, [changed])).toThrow();
    expect(() => planReviewSuggestionDecision(round, session, state, proposal.id, 'rejected', undefined, [resolution])).toThrow();
    const mechanical = structuredClone(state);mechanical.proposals[0].origin.kind = 'mechanical';
    expect(() => planReviewSuggestionDecision(round, session, mechanical, proposal.id, 'accepted', undefined, [resolution])).toThrow(/manual/);
  });
});
