import { describe, expect, it } from 'vitest';
import type { SerializedSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { createMechanicalReviewProposal, mechanicalReviewCandidates } from '@/lib/mechanicalReviewProposals';
import { emptyReviewSuggestionState, inspectReviewSuggestion, planReviewSuggestionDecision, planReviewSuggestionHistory,
  validateReviewSuggestion } from '@/lib/reviewSuggestions';

function fixture() {
  const session: SerializedSession = { documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
    formType: 'navmc_10274', timestamp: 1,
    formData: { subject: 'TRAINING EXAMPLE', to: 'Example recipient', date: '13 November 2026', sigFirst: ' A . ' },
    paragraphs: [{ id: 'first', text: '😀 Due 5 Nov 2026 and 06 Dec 2026; quote "1 Jan 2026".', level: 0 },
      { id: 'second', text: 'An unrelated paragraph.', level: 0 }],
    references: [{ letter: 'a', title: 'Alpha (notal)', url: 'https://example.com/alpha' }, { letter: 'b', title: 'Bravo' }],
    enclosures: [], copyTos: [], distributions: [] };
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt: 1, label: 'Training review', sourceDocumentId: 'source', ownerDocumentId: 'source', baselineDigest: 'a'.repeat(64),
    baseline: { ts: 1, session: structuredClone(session) } };
  return { round, session };
}

const selectable = (round: ReviewRound) => mechanicalReviewCandidates(round, 'military').filter(candidate => candidate.after !== undefined);

describe('existing formatting findings as review proposals', () => {
  it('reuses native checks, combines spans per paragraph, and leaves the pinned baseline untouched', () => {
    const { round, session } = fixture();
    const candidates = selectable(round);
    expect(candidates.map(candidate => candidate.source)).toEqual(['field', 'field', 'body', 'body', 'references']);
    const proposal = createMechanicalReviewProposal(round, { author: 'Example reviewer', bodyAudience: 'military', selectedIds: candidates.map(candidate => candidate.id) });
    expect(proposal.changes).toHaveLength(4);
    expect(proposal.changes.find(change => change.target.kind === 'paragraph')).toMatchObject({ expected: session.paragraphs[0].text,
      proposed: '😀 Due 5 November 2026 and 6 December 2026; quote "1 Jan 2026".' });
    expect(proposal.origin.context).toContain('military');
    expect(round.baseline.session).toEqual(session);
    expect(validateReviewSuggestion(round, JSON.parse(JSON.stringify(proposal)))).toEqual(proposal);
  });

  it('preserves later unrelated edits and follows the original paragraph through movement', () => {
    const { round, session } = fixture();
    const proposal = createMechanicalReviewProposal(round, { author: 'Example', bodyAudience: 'military', selectedIds: selectable(round).map(candidate => candidate.id) });
    session.formData.to = 'Later recipient';session.paragraphs.reverse();
    session.paragraphs.push({ id: 'later', text: 'Later text.', level: 0 });
    const state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
    const plan = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    expect(plan.status).toBe('ready');
    expect(plan.session.formData).toMatchObject({ to: 'Later recipient', date: '13 Nov 26', sigFirst: 'A.' });
    expect(plan.session.paragraphs.map(paragraph => paragraph.id)).toEqual(['second', 'first', 'later']);
    expect(plan.session.paragraphs[1].text).toContain('5 November 2026');
    expect(plan.session.paragraphs[2].text).toBe('Later text.');
    expect(plan.session.references[0]).toEqual({ ...session.references[0], title: 'Alpha (NOTAL)' });
    expect(plan.state.decisions).toHaveLength(1);
    expect(session.formData.sigFirst).toBe(' A . ');
    expect(state.decisions).toHaveLength(0);
  });

  it('rejects the entire group after one target changes without applying its other members', () => {
    const { round, session } = fixture();
    const proposal = createMechanicalReviewProposal(round, { author: 'Example', bodyAudience: 'military', selectedIds: selectable(round).map(candidate => candidate.id) });
    session.paragraphs[0].text += ' Later body edit.';
    const before = structuredClone(session);
    const plan = planReviewSuggestionDecision(round, session, { ...emptyReviewSuggestionState(round), proposals: [proposal] }, proposal.id, 'accepted');
    expect(plan.status).toBe('stale');expect(plan.session).toEqual(before);expect(plan.state.decisions).toEqual([]);
  });

  it('requires an explicit body audience and rejects stale, duplicate, unknown or manual-only selections', () => {
    const { round } = fixture();
    const body = selectable(round).find(candidate => candidate.source === 'body')!;
    expect(mechanicalReviewCandidates(round, null).some(candidate => candidate.source === 'body')).toBe(false);
    for (const selectedIds of [[], ['missing'], [body.id, body.id]]) expect(() => createMechanicalReviewProposal(round,
      { author: 'Example', bodyAudience: 'military', selectedIds })).toThrow();
    expect(() => createMechanicalReviewProposal(round, { author: 'Example', bodyAudience: 'civilian', selectedIds: [body.id] })).toThrow();
    round.baseline.session.paragraphs[0].text = 'Due 5 Nov 26.';
    const advisory = mechanicalReviewCandidates(round, 'military').find(candidate => candidate.source === 'body')!;
    expect(advisory.after).toBeUndefined();
    expect(() => createMechanicalReviewProposal(round, { author: 'Example', bodyAudience: 'military', selectedIds: [advisory.id] })).toThrow(/manual review/);
  });

  it('combines many existing date findings into one whole-paragraph replacement', () => {
    const { round } = fixture();
    round.baseline.session.paragraphs[0].text = 'Due 5 Nov 2026. '.repeat(30);
    const candidates = selectable(round).filter(candidate => candidate.source === 'body');
    const proposal = createMechanicalReviewProposal(round, { author: 'Example', bodyAudience: 'military', selectedIds: candidates.map(candidate => candidate.id) });
    expect(candidates).toHaveLength(30);expect(proposal.changes).toHaveLength(1);
    expect(proposal.changes[0].proposed).toBe('Due 5 November 2026. '.repeat(30));
  });

  it('leaves unsupported document families in the existing local workflow', () => {
    const { round } = fixture();round.baseline.session.docType = 'sl3';
    expect(mechanicalReviewCandidates(round, 'military')).toEqual([]);
  });

  it('explains limits on distinct targets and complete values without truncating the proposal', () => {
    const { round } = fixture();
    round.baseline.session.paragraphs = Array.from({ length: 21 }, (_, index) => ({ id: `paragraph-${index}`, text: 'Due 5 Nov 2026.', level: 0 }));
    const bodyIds = () => selectable(round).filter(candidate => candidate.source === 'body').map(candidate => candidate.id);
    expect(() => createMechanicalReviewProposal(round, { author: 'Example', bodyAudience: 'military', selectedIds: bodyIds() })).toThrow(/no more than 20/);
    round.baseline.session.paragraphs = [{ id: 'long', text: 'Due 5 Nov 2026; ' + 'x'.repeat(20_000), level: 0 }];
    expect(() => createMechanicalReviewProposal(round, { author: 'Example', bodyAudience: 'military', selectedIds: bodyIds() })).toThrow(/20,000-character/);
    round.baseline.session.paragraphs = Array.from({ length: 10 }, (_, index) => ({ id: `paragraph-${index}`, text: 'Due 5 Nov 2026; ' + 'x'.repeat(11_000), level: 0 }));
    expect(() => createMechanicalReviewProposal(round, { author: 'Example', bodyAudience: 'military', selectedIds: bodyIds() })).toThrow(/smaller group/);
  });
});

describe('NOTAL review targets without reference identities', () => {
  function referenceFixture() {
    const result = fixture();
    const candidate = selectable(result.round).find(item => item.source === 'references')!;
    const proposal = createMechanicalReviewProposal(result.round, { author: 'Example', bodyAudience: null, selectedIds: [candidate.id] });
    return { ...result, proposal, state: { ...emptyReviewSuggestionState(result.round), proposals: [proposal] } };
  }

  it.each(['reorder', 'insert', 'remove', 'url', 'other-title', 'letter'] as const)('blocks all changes after reference-list %s', mutation => {
    const { round, session, proposal, state } = referenceFixture();
    if (mutation === 'reorder') session.references.reverse();
    if (mutation === 'insert') session.references.push({ letter: 'c', title: 'Added source' });
    if (mutation === 'remove') session.references.pop();
    if (mutation === 'url') session.references[0].url = 'https://example.com/replaced';
    if (mutation === 'other-title') session.references[1].title = 'Changed source';
    if (mutation === 'letter') session.references[1].letter = 'c';
    const before = structuredClone(session);
    const plan = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    expect(plan.status).toBe('stale');expect(plan.session).toEqual(before);expect(plan.state.decisions).toEqual([]);
  });

  it('does not mislabel the accepted title as changed and guards exact Undo/Redo reference collections', () => {
    const { round, session, proposal, state } = referenceFixture();
    const accepted = planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted');
    expect(inspectReviewSuggestion(round, accepted.session, proposal)[0].current).toBe('Alpha (NOTAL)');
    const acceptanceId = accepted.state.decisions[0].id;
    const undone = planReviewSuggestionHistory(round, accepted.session, session, accepted.state, acceptanceId, 'undo');
    expect(planReviewSuggestionHistory(round, session, accepted.session, undone, acceptanceId, 'redo').decisions.map(item => item.action)).toEqual(['accepted', 'reversed', 'restored']);
    accepted.session.references[1].url = 'https://example.com/later';
    expect(() => planReviewSuggestionHistory(round, accepted.session, session, accepted.state, acceptanceId, 'undo')).toThrow(/reference list/);
  });

  it('rejects forged or arbitrary reference replacements instead of treating a title as identity', () => {
    const { round, proposal } = referenceFixture();
    const changed = structuredClone(proposal);changed.changes[0].proposed = 'Different source';
    expect(() => validateReviewSuggestion(round, changed)).toThrow(/NOTAL/);
    const manual = structuredClone(proposal);manual.origin = { kind: 'manual' };
    expect(() => validateReviewSuggestion(round, manual)).toThrow(/NOTAL/);
  });

  it('does not make body-only suggestions stale when unrelated references change', () => {
    const { round, session } = fixture();
    const proposal = createMechanicalReviewProposal(round, { author: 'Example', bodyAudience: 'military',
      selectedIds: selectable(round).filter(item => item.source === 'body').map(item => item.id) });
    session.references.reverse();
    expect(planReviewSuggestionDecision(round, session, { ...emptyReviewSuggestionState(round), proposals: [proposal] }, proposal.id, 'accepted').status).toBe('ready');
  });
});
