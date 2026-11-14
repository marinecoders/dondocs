import { describe, expect, it } from 'vitest';
import type { SerializedSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import {
  appendReviewSuggestions, createReviewSuggestion, emptyReviewSuggestionState, planReviewSuggestionDecision,
  planReviewSuggestionHistory, latestReviewSuggestionDecision,
  reviewSuggestionSchema, reviewSuggestionStateSchema, suggestionTargetValue, validateReviewSuggestion,
  type ReviewSuggestion, type ReviewSuggestionState,
} from '@/lib/reviewSuggestions';

function fixture() {
  const session: SerializedSession = { documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
    formType: 'navmc_10274', formData: { subject: 'EXAMPLE', from: 'Example sender', to: 'Original recipient', date: '13 Nov 26' },
    paragraphs: [{ id: 'first', text: 'First body.', level: 0 }, { id: 'second', text: 'Second body.', level: 0 }],
    references: [], enclosures: [], copyTos: [], distributions: [], timestamp: 1 };
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt: 1, label: 'Example review', sourceDocumentId: 'source', ownerDocumentId: 'source', baselineDigest: 'a'.repeat(64),
    baseline: { ts: 1, session: structuredClone(session) } };
  const field = { kind: 'field', field: 'to', docType: 'naval_letter' } as const;
  const paragraph = { kind: 'paragraph', paragraphId: 'second', docType: 'naval_letter' } as const;
  const proposal = createReviewSuggestion(round, { author: 'Example reviewer', label: 'Recipient correction',
    changes: [{ target: field, proposed: 'Proposed recipient' }] });
  const state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
  return { session, round, field, paragraph, proposal, state };
}

describe('reviewer replacement suggestions', () => {
  it('creates a bounded proposal without altering the baseline or current document', () => {
    const { session, round, proposal } = fixture();
    expect(proposal.changes[0]).toMatchObject({ expected: 'Original recipient', proposed: 'Proposed recipient' });
    expect(round.baseline.session).toEqual(session);
    expect(session.formData.to).toBe('Original recipient');
    expect(validateReviewSuggestion(round, JSON.parse(JSON.stringify(proposal)))).toEqual(proposal);
  });

  it('accepts only the requested field while preserving newer body, other fields, assets and comments', () => {
    const { session, round, state, proposal } = fixture();
    session.paragraphs.push({ id: 'new', text: 'Newer draft work.', level: 0 });
    session.formData.subject = 'NEWER SUBJECT';
    session.enclosures.push({ title: 'New attachment', fileRef: { id: 'asset', name: 'example.pdf', size: 42, type: 'application/pdf' } });
    session.reviewComments = { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
      messages: [{ id: crypto.randomUUID(), author: 'Example', text: 'Newer discussion.', createdAt: '2026-11-13T00:00:00Z' }] }] };
    const before = structuredClone(session);
    const plan = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    expect(plan.status).toBe('ready');expect(plan.session.formData.to).toBe('Proposed recipient');
    expect({ ...plan.session.formData, to: before.formData.to }).toEqual(before.formData);
    expect(plan.session.paragraphs).toEqual(before.paragraphs);expect(plan.session.enclosures).toEqual(before.enclosures);
    expect(plan.session.reviewComments).toEqual(before.reviewComments);
    expect(session).toEqual(before);expect(state.decisions).toEqual([]);
    expect(plan.state.decisions).toEqual([expect.objectContaining({ proposalId: proposal.id, action: 'accepted' })]);
  });

  it('follows a stable paragraph after movement instead of replacing its former array index', () => {
    const { session, round, paragraph } = fixture();
    const proposal = createReviewSuggestion(round, { author: 'Example', label: 'Body', changes: [{ target: paragraph, proposed: 'Revised second body.' }] });
    const state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
    session.paragraphs.reverse();
    const plan = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    expect(plan.status).toBe('ready');
    expect(plan.session.paragraphs).toEqual([{ id: 'second', text: 'Revised second body.', level: 0 }, { id: 'first', text: 'First body.', level: 0 }]);
  });

  it('rejects an overlapping edit without touching text or recording a partial decision', () => {
    const { session, round, proposal, state } = fixture();session.formData.to = 'Newer recipient';
    const plan = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    expect(plan.status).toBe('stale');expect(plan.session).toEqual(session);expect(plan.state.decisions).toEqual([]);
    expect(plan.changes[0]).toMatchObject({ baseline: 'Original recipient', current: 'Newer recipient', proposed: 'Proposed recipient', stale: true });
  });

  it('records a rejection even when the target changed, without editing the document', () => {
    const { session, round, proposal, state } = fixture();session.formData.to = 'Newer recipient';
    const plan = planReviewSuggestionDecision(round, session, state, proposal.id, 'rejected');
    expect(plan.status).toBe('ready');expect(plan.session).toEqual(session);
    expect(plan.state.decisions[0].action).toBe('rejected');
  });

  it('preflights every mechanical group member before changing any target', () => {
    const { session, round, field, paragraph } = fixture();
    const proposal = createReviewSuggestion(round, { author: 'Example', label: 'Grouped corrections', origin: { kind: 'mechanical', rule: 'example-rule', context: 'Audience selected by drafter' },
      changes: [{ target: field, proposed: 'Recipient' }, { target: paragraph, proposed: 'Updated body.' }] });
    const state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
    session.paragraphs[1].text = 'Independent edit.';
    const plan = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    expect(plan.status).toBe('stale');expect(plan.session.formData.to).toBe('Original recipient');expect(plan.session).toEqual(session);
    expect(plan.state.decisions).toHaveLength(0);
    session.paragraphs[1].text = 'Second body.';
    const ready = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    expect(ready.status).toBe('ready');expect(ready.session.formData.to).toBe('Recipient');expect(ready.session.paragraphs[1].text).toBe('Updated body.');
    expect(ready.state.decisions).toHaveLength(1);
  });

  it('never reattaches a missing or duplicate paragraph by matching text', () => {
    const { session, round, paragraph } = fixture();
    const proposal = createReviewSuggestion(round, { author: 'Example', label: 'Body', changes: [{ target: paragraph, proposed: 'Replacement.' }] });
    const state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
    session.paragraphs[1].id = 'replacement';
    expect(planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted').status).toBe('stale');
    session.paragraphs[1].id = 'second';session.paragraphs.push({ ...session.paragraphs[1] });
    expect(planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted').status).toBe('stale');
  });

  it('blocks acceptance after the same paragraph becomes an unsupported structural block', () => {
    const { session, round, paragraph } = fixture();
    const proposal = createReviewSuggestion(round, { author: 'Example', label: 'Body', changes: [{ target: paragraph, proposed: 'Replacement.' }] });
    const state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
    for (const structural of [{ figure: { name: 'figure.png' } }, { tableKey: 'table' }, { callout: 'note' as const }, { procedure: true }, { appendix: true }]) {
      const current = structuredClone(session);Object.assign(current.paragraphs[1], structural);
      expect(planReviewSuggestionDecision(round, current, state, proposal.id, 'accepted').status).toBe('stale');
    }
  });

  it('does not apply the same proposal twice or reverse an existing rejection by replay', () => {
    const { session, round, proposal, state } = fixture();
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    const again = planReviewSuggestionDecision(round, accepted.session, accepted.state, proposal.id, 'accepted');
    expect(again.status).toBe('decided');expect(again.state).toEqual(accepted.state);
    const rejected = planReviewSuggestionDecision(round, session, state, proposal.id, 'rejected');
    expect(planReviewSuggestionDecision(round, session, rejected.state, proposal.id, 'accepted').status).toBe('decided');
  });

  it('retains acceptance history while recording its exact Undo and Redo reversals', () => {
    const { session, round, proposal, state } = fixture();
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    const acceptanceId = accepted.state.decisions[0].id;
    const undone = planReviewSuggestionHistory(round, accepted.session, session, accepted.state, acceptanceId, 'undo');
    expect(undone.decisions[0]).toEqual(accepted.state.decisions[0]);
    expect(latestReviewSuggestionDecision(undone, proposal.id)).toMatchObject({ action: 'reversed', acceptanceId });
    const reloaded = reviewSuggestionStateSchema.parse(JSON.parse(JSON.stringify(undone)));
    const redone = planReviewSuggestionHistory(round, session, accepted.session, reloaded, acceptanceId, 'redo');
    expect(redone.decisions.map(decision => decision.action)).toEqual(['accepted', 'reversed', 'restored']);
    expect(() => planReviewSuggestionHistory(round, accepted.session, session, redone, acceptanceId, 'redo')).toThrow();
  });

  it('does not mistake Undo of unrelated work for Undo of the accepted replacement', () => {
    const { session, round, proposal, state } = fixture();
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    const later = structuredClone(accepted.session);later.formData.subject = 'Unrelated edit';
    expect(() => planReviewSuggestionHistory(round, later, accepted.session, accepted.state, accepted.state.decisions[0].id, 'undo')).toThrow(/does not reverse/);
    expect(accepted.state.decisions).toHaveLength(1);
  });

  it('allows a deliberate new decision after Undo but refuses an obsolete acceptance history action', () => {
    const { session, round, proposal, state } = fixture();
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    const oldId = accepted.state.decisions[0].id;
    const undone = planReviewSuggestionHistory(round, accepted.session, session, accepted.state, oldId, 'undo');
    const newAcceptance = planReviewSuggestionDecision(round, session, undone, proposal.id, 'accepted');
    expect(newAcceptance.status).toBe('ready');expect(newAcceptance.state.decisions).toHaveLength(3);
    expect(() => planReviewSuggestionHistory(round, newAcceptance.session, session, newAcceptance.state, oldId, 'undo')).toThrow(/latest review decision/);
    const malformed = structuredClone(newAcceptance.state);malformed.decisions[1].acceptanceId = crypto.randomUUID();
    expect(reviewSuggestionStateSchema.safeParse(malformed).success).toBe(false);
  });

  it('imports new immutable proposals idempotently and rejects changed content under an existing ID', () => {
    const { round, proposal } = fixture();
    const first = appendReviewSuggestions(round, emptyReviewSuggestionState(round), [proposal]);
    expect(appendReviewSuggestions(round, first, [structuredClone(proposal)])).toEqual(first);
    const changed = structuredClone(proposal);changed.changes[0].proposed = 'Changed recipient';
    expect(() => appendReviewSuggestions(round, first, [changed])).toThrow(/existing identity/);
    expect(first.proposals).toEqual([proposal]);
  });

  it('rejects foreign rounds, forged baseline values, unsupported structures and extra authority', () => {
    const { round, proposal, field } = fixture();
    for (const changed of [{ ...proposal, roundId: `review_${crypto.randomUUID()}` }, { ...proposal, baselineDigest: 'b'.repeat(64) },
      { ...proposal, ownerDocumentId: 'source' }, { ...proposal, changes: [{ ...proposal.changes[0], expected: 'Forged value' }] },
      { ...proposal, changes: [{ ...proposal.changes[0], target: { kind: 'range', start: 0, end: 1 } }] }]) {
      expect(() => validateReviewSuggestion(round, changed)).toThrow();
    }
    expect(() => createReviewSuggestion(round, { author: 'Example', label: 'Duplicate', changes: [{ target: field, proposed: 'One' }, { target: field, proposed: 'Two' }] })).toThrow();
    round.baseline.session.paragraphs[0].figure = { name: 'figure.png' };
    expect(suggestionTargetValue(round.baseline.session, { kind: 'paragraph', paragraphId: 'first', docType: 'naval_letter' })).toBeNull();
    expect(suggestionTargetValue(round.baseline.session, { kind: 'field', field: 'constructor', docType: 'naval_letter' })).toBeNull();
  });

  it('preserves complete Unicode and allows deliberate empty text replacements', () => {
    const { round, field, session } = fixture();
    for (const proposed of ['Équipe 👩🏽‍✈️ — 日本語', '']) {
      const proposal = createReviewSuggestion(round, { author: 'Example', label: 'Unicode', changes: [{ target: field, proposed }] });
      const state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
      expect(planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted').session.formData.to).toBe(proposed);
    }
  });

  it('rejects no-op, oversized, duplicate member and unknown decision records', () => {
    const { round, field, proposal, state } = fixture();
    expect(() => createReviewSuggestion(round, { author: 'Example', label: 'No-op', changes: [{ target: field, proposed: 'Original recipient' }] })).toThrow();
    expect(() => createReviewSuggestion(round, { author: 'Example', label: 'Large', changes: [{ target: field, proposed: 'x'.repeat(20_001) }] })).toThrow();
    const duplicate: ReviewSuggestion = { ...proposal, origin: { kind: 'mechanical' }, changes: [proposal.changes[0], proposal.changes[0]] };
    expect(reviewSuggestionSchema.safeParse(duplicate).success).toBe(false);
    const invalid: ReviewSuggestionState = { ...state, decisions: [{ id: crypto.randomUUID(), proposalId: `proposal_${crypto.randomUUID()}`,
      roundId: round.id, baselineDigest: round.baselineDigest, action: 'accepted', decidedAt: 1 }] };
    expect(reviewSuggestionStateSchema.safeParse(invalid).success).toBe(false);
  });
});
