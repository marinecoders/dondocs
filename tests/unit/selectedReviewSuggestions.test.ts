import { describe, expect, it, vi } from 'vitest';
import { captureTextRange } from '@/lib/reviewTextRanges';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';
import { createSelectedTextSuggestion, emptyReviewSuggestionState, inspectReviewSuggestion, planReviewSuggestionDecision,
  planReviewSuggestionHistory, appendReviewSuggestions, applyReviewSuggestionRange, reviewSuggestionText, validateReviewSuggestion, validateReviewSuggestionState } from '@/lib/reviewSuggestions';
import { planReviewSuggestionWrite, type ReviewSuggestionWrite } from '@/lib/reviewSuggestionWrites';
import { createSuggestionReviewReturn, parseReviewReturn } from '@/lib/reviewReturns';

function fixture(text = 'Keep Alpha Alpha ending.') {
  const session = createBlankSession();
  session.paragraphs = [{ id: 'selected-body', text, level: 0 }, { id: 'other-body', text: 'Unrelated current work.', level: 0 }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    createdAt: 1, label: 'Synthetic selection review', sourceDocumentId: 'source', ownerDocumentId: 'source', baselineDigest: 'a'.repeat(64),
    baseline: { ts: 1, session: structuredClone(session) } };
  const make = (start = 11, end = 16, proposed = 'Bravo') => createSelectedTextSuggestion(round, {
    author: 'Synthetic reviewer', paragraphId: 'selected-body', start, end, proposed,
  });
  const proposal = make(), state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
  return { session, round, make, proposal, state };
}

function historyWrite(input: ReturnType<typeof fixture>, state: ReturnType<typeof emptyReviewSuggestionState>, direction: 'undo' | 'redo', before: typeof input.session, after: typeof input.session): ReviewSuggestionWrite {
  const acceptanceId = state.decisions[0].id;
  const next = planReviewSuggestionHistory(input.round, before, after, state, acceptanceId, direction), record = next.decisions.at(-1)!;
  return { kind: 'suggestion-write', version: 1, id: `suggestion-write_${crypto.randomUUID()}`, documentId: 'source', createdAt: 1,
    round: { id: input.round.id, baselineDigest: input.round.baselineDigest }, before: state, after: next,
    intent: { kind: 'history', acceptanceId, direction, record: { id: record.id, decidedAt: record.decidedAt } } };
}

describe('precise selected text replacements', () => {
  it('validates and inspects selected text without cloning the complete baseline', () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      expect(validateReviewSuggestion(input.round, input.proposal)).toEqual(input.proposal);
      expect(inspectReviewSuggestion(input.round, input.session, input.proposal)[0].current).toBe('Alpha');
      // Read-only comparisons run for every proposal on each render. Applying a
      // temporary replacement here also copies all unrelated document content.
      expect(clone.mock.calls.filter(([value]) => value === input.round.baseline.session)).toHaveLength(0);
    } finally { clone.mockRestore(); }
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps read-only validation and application aligned on complete supported replacement text', () => {
    const input = fixture(), change = input.proposal.changes[0];
    const target = change.target;
    if (target.kind !== 'range') throw new Error('Expected selected range.');
    for (const [proposed, valid] of [
      ['Bravo', true], ['', true], ['Équipe 👩🏽‍✈️ 日本語', true], ['**bold**', false], ['{{NAME}}', false],
      ['new\nparagraph', false], ['\ud800', false], ['\u0301', false], ['x'.repeat(20_000), false],
    ] as const) {
      const validate = () => validateReviewSuggestion(input.round, { ...input.proposal, changes: [{ ...change, proposed }] });
      const apply = () => applyReviewSuggestionRange(input.round.baseline.session, target, change.expected, proposed);
      if (valid) {
        expect(validate).not.toThrow();expect(apply().paragraphs[0].text).toBe(`Keep Alpha ${proposed} ending.`);
      } else { expect(validate).toThrow();expect(apply).toThrow(); }
    }
  });

  it('captures the second repeated occurrence without changing either document and splices only that span', () => {
    const input = fixture(), before = structuredClone(input.session);
    expect(input.proposal.changes[0]).toMatchObject({ expected: 'Alpha', target: { kind: 'range', start: 11, end: 16, context: 'Keep Alpha Alpha ending.' } });
    input.session.formData.subject = 'NEWER SUBJECT';input.session.paragraphs.reverse();
    const accepted = planReviewSuggestionDecision(input.round, input.session, input.state, input.proposal.id, 'accepted');
    expect(accepted.status).toBe('ready');
    expect(accepted.session.paragraphs).toEqual([{ id: 'other-body', text: 'Unrelated current work.', level: 0 }, { id: 'selected-body', text: 'Keep Alpha Bravo ending.', level: 0 }]);
    expect(accepted.session.formData.subject).toBe('NEWER SUBJECT');
    expect(input.round.baseline.session).toEqual(before);expect(input.session.paragraphs[1].text).toBe(before.paragraphs[0].text);
    expect(accepted.session).not.toHaveProperty('reviewSuggestions');
  });

  it('rejects changed context, changed selection, duplicate identity, deleted and newly formatted paragraphs', () => {
    for (const edit of [
      (source: ReturnType<typeof fixture>['session']) => { source.paragraphs[0].text = 'Keep Alpha Gamma ending.'; },
      (source: ReturnType<typeof fixture>['session']) => { source.paragraphs.push({ ...source.paragraphs[0] }); },
      (source: ReturnType<typeof fixture>['session']) => { source.paragraphs[0].id = 'changed-id'; },
      (source: ReturnType<typeof fixture>['session']) => { source.paragraphs[0].header = 'Example heading'; },
      (source: ReturnType<typeof fixture>['session']) => { source.paragraphs[0].text = 'Keep Alpha **Alpha** ending.'; },
    ]) {
      const input = fixture();edit(input.session);const before = structuredClone(input.session);
      const plan = planReviewSuggestionDecision(input.round, input.session, input.state, input.proposal.id, 'accepted');
      expect(plan.status).toBe('stale');expect(plan.session).toEqual(before);expect(plan.state.decisions).toEqual([]);
      expect(planReviewSuggestionDecision(input.round, input.session, input.state, input.proposal.id, 'rejected').session).toEqual(before);
    }
  });

  it('retains exact range decisions through serialization, duplicate return replay, Undo and Redo writers', () => {
    const input = fixture();
    const payload = createSuggestionReviewReturn(input.round.id, input.round.baselineDigest, undefined, [input.proposal], { marking: 'UNCLASSIFIED', customMarkings: [] });
    const parsed = parseReviewReturn(JSON.parse(JSON.stringify(payload)));
    if (parsed.version !== 2) throw new Error('Expected suggestion return');
    const returned = appendReviewSuggestions(input.round, emptyReviewSuggestionState(input.round), parsed.proposals!);
    expect(appendReviewSuggestions(input.round, returned, parsed.proposals!)).toEqual(returned);
    const accepted = planReviewSuggestionDecision(input.round, input.session, returned, input.proposal.id, 'accepted');
    expect(inspectReviewSuggestion(input.round, accepted.session, input.proposal)[0].current).toBe('Bravo');
    expect(planReviewSuggestionDecision(input.round, accepted.session, accepted.state, input.proposal.id, 'accepted').status).toBe('decided');
    const reloaded = validateReviewSuggestionState(input.round, JSON.parse(JSON.stringify(accepted.state)));
    const undo = historyWrite(input, reloaded, 'undo', accepted.session, input.session);
    expect(planReviewSuggestionWrite(input.round, accepted.session, undo, input.session).session).toEqual(input.session);
    const redo = historyWrite(input, undo.after, 'redo', input.session, accepted.session);
    expect(planReviewSuggestionWrite(input.round, input.session, redo, accepted.session).session).toEqual(accepted.session);
    expect(redo.after.decisions.map(item => item.action)).toEqual(['accepted', 'reversed', 'restored']);
    const unrelated = structuredClone(input.session);unrelated.paragraphs[0].text = 'Keep Bravo Alpha ending.';
    expect(() => historyWrite(input, reloaded, 'undo', accepted.session, unrelated)).toThrow(/reverse/);
  });

  it('supports whole graphemes, deletion and explicit caret insertion without splitting characters', () => {
    const input = fixture('Keep Alpha Alpha ending.');
    for (const [start, end, proposed, text] of [
      [11, 16, 'Équipe 👩🏽‍✈️ 日本語', 'Keep Alpha Équipe 👩🏽‍✈️ 日本語 ending.'],
      [11, 16, '', 'Keep Alpha  ending.'], [11, 11, 'new ', 'Keep Alpha new Alpha ending.'],
    ] as const) {
      const proposal = input.make(start, end, proposed), state = { ...input.state, proposals: [proposal] };
      const accepted = planReviewSuggestionDecision(input.round, input.session, state, proposal.id, 'accepted');
      expect(accepted.session.paragraphs[0].text).toBe(text);
      expect(planReviewSuggestionHistory(input.round, accepted.session, input.session, accepted.state, accepted.state.decisions[0].id, 'undo').decisions.at(-1)?.action).toBe('reversed');
    }
    input.round.baseline.session.paragraphs[0].text = 'A 👩🏽‍✈️ é Z';
    expect(() => input.make(3, 4)).toThrow();expect(() => input.make(10, 11)).toThrow();
  });

  it('rejects malformed, forged tracking, detached, mechanical, no-op and unsafe replacement targets', () => {
    const input = fixture(), change = input.proposal.changes[0];
    for (const target of [
      { ...change.target, start: -1 }, { ...change.target, end: 99 }, { ...change.target, docType: 'army_memo' },
      { ...change.target, context: 'Fake Alpha Alpha ending.' }, { ...change.target, detached: true },
      { ...change.target, tracking: { context: 'Keep Alpha Alpha ending.', start: 11, end: 16 } },
    ]) expect(() => validateReviewSuggestion(input.round, { ...input.proposal, changes: [{ ...change, target }] })).toThrow();
    expect(() => validateReviewSuggestion(input.round, { ...input.proposal, origin: { kind: 'mechanical' } })).toThrow();
    for (const proposed of ['Alpha', '**bold**', '{{variable}}', 'new\nparagraph', 'x'.repeat(20_001), 'é'.slice(1)]) expect(() => input.make(11, 16, proposed)).toThrow();
    expect(() => planReviewSuggestionDecision(input.round, input.session, input.state, input.proposal.id, 'accepted', undefined,
      [{ changeId: change.id, expectedCurrent: 'Alpha', value: 'Forged range resolution' }])).toThrow();
  });

  it('counts retained context against aggregate limits and includes it in handling scans', () => {
    const input = fixture();input.round.baseline.session.paragraphs[0].text = 'Synthetic SSN 123-45-6789. ' + 'x'.repeat(19_900);
    const proposal = input.make(0, 9, 'Example');
    expect(reviewSuggestionText([proposal]).some(field => field.value.includes('123-45-6789'))).toBe(true);
    const proposals = Array.from({ length: 11 }, () => input.make(0, 9, 'Example'));
    expect(() => appendReviewSuggestions(input.round, emptyReviewSuggestionState(input.round), proposals)).toThrow();
  });
});


describe('selected decisions preserve discussions through exact history', () => {
  it('restores detached and shifted anchors with Undo/Redo and rejects discussion forgery', () => {
    const input = fixture();
    const anchors = [captureTextRange(input.session, 'selected-body', 5, 10)!, captureTextRange(input.session, 'selected-body', 11, 16)!, captureTextRange(input.session, 'selected-body', 17, 23)!];
    input.session.reviewComments = { version: 3, threads: anchors.map(anchor => ({ id: crypto.randomUUID(), anchor,
      messages: [{ id: crypto.randomUUID(), author: 'Synthetic chief', text: 'Retain this discussion.', createdAt: new Date(1).toISOString() }], resolved: false })) };
    const original = structuredClone(input.session);
    const accepted = planReviewSuggestionDecision(input.round, original, input.state, input.proposal.id, 'accepted');
    expect(accepted.session.reviewComments!.threads[1].anchor).toMatchObject({ detached: true });
    expect(accepted.session.reviewComments!.threads[2].anchor).toMatchObject({ tracking: { context: 'Keep Alpha Bravo ending.' } });
    const undo = historyWrite(input, accepted.state, 'undo', accepted.session, original);
    const undone = planReviewSuggestionWrite(input.round, accepted.session, undo, original);
    expect(undone.session).toEqual(original);
    const redo = historyWrite(input, undone.state, 'redo', original, accepted.session);
    expect(planReviewSuggestionWrite(input.round, original, redo, accepted.session).session).toEqual(accepted.session);
    for (const forge of [
      (value: typeof original) => { value.reviewComments!.threads[0].messages[0].text = 'Unrelated overwritten discussion'; },
      (value: typeof original) => { value.reviewComments!.threads.pop(); },
      (value: typeof original) => { value.reviewComments!.threads[0].anchor = anchors[1]; },
    ]) {
      const destination = structuredClone(original);forge(destination);
      expect(() => planReviewSuggestionWrite(input.round, accepted.session, undo, destination)).toThrow(/discussion/);
      expect(original.reviewComments!.threads[0].messages[0].text).toBe('Retain this discussion.');
    }
  });
});
