import { expect, it, vi } from 'vitest';
import { editReviewTypingDraft as edit, emptyReviewTypingDraft as empty, typingChangeKind, typingDeletion } from '@/lib/reviewTypingDraft';
import { createSelectedTextSuggestion, planReviewSuggestionDecision, emptyReviewSuggestionState, reviewSuggestionText } from '@/lib/reviewSuggestions';
import { createBlankSession } from '@/stores/documentStore';
import type { ReviewRound } from '@/lib/reviewRounds';

it('uses exact input coordinates for repeated characters, coalescing uninterrupted typing and returning to baseline', () => {
  let draft = edit(empty('aaaa'), 2, 2, 'a');
  expect(draft).toMatchObject({ start: 2, end: 2, proposed: 'a' });
  draft = edit(draft, 3, 3, 'bc');expect(draft).toMatchObject({ text: 'aaabcaa', start: 2, end: 2, proposed: 'abc' });
  expect(typingChangeKind(draft)).toBe('Insertion');
  expect(edit(draft, 2, 5, '')).toEqual(empty('aaaa'));
});
it('expands one honest envelope for separate edits before and after a prior insertion', () => {
  let draft = edit(empty('Alpha beta gamma.'), 6, 6, 'new ');
  draft = edit(draft, 0, 5, 'Bravo');draft = edit(draft, draft.text.length - 1, draft.text.length, '!');
  expect(draft).toMatchObject({ text: 'Bravo new beta gamma!', start: 0, end: 17, proposed: 'Bravo new beta gamma!' });
  expect(typingChangeKind(draft)).toBe('Replacement');
});
it('keeps complete graphemes for combining input, deletion and exact replacements', () => {
  const text = 'A 👩🏽‍✈️ é Z';
  const span = typingDeletion(text, 9, 9, true);expect(span).toEqual({ start: 2, end: 9 });
  const draft = edit(empty(text), span.start, span.end, '');expect(typingChangeKind(draft)).toBe('Deletion');
  expect(edit(empty('A Z'), 1, 1, '\u0301')).toMatchObject({ start: 0, end: 1, proposed: 'Á' });
  expect(typingDeletion(text, 2, 2, false)).toEqual(span);
  expect(() => edit(empty(text), 3, 4, '')).toThrow(/complete characters/);
});
it('expands a long joined character without segmenting the paragraph for every code unit', () => {
  const baseline = 'A' + '\u0301'.repeat(4_999);
  const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
  try {
    expect(edit(empty(baseline), baseline.length, baseline.length, '\u0301')).toMatchObject({ start: 0, end: baseline.length, proposed: baseline + '\u0301' });
    expect(segment.mock.calls.length).toBeLessThan(20);
  } finally { segment.mockRestore(); }
});
it('rejects unsupported structures, variables, formatting, malformed characters and quotas without changing prior draft', () => {
  const draft = edit(empty('Baseline.'), 8, 8, ' valid');const before = structuredClone(draft);
  for (const insert of ['\n', '\r', '**bold**', '{{value}}', '\\command', '\uD800', 'x'.repeat(20_001)]) expect(() => edit(draft, 0, 0, insert)).toThrow();
  expect(draft).toEqual(before);
});
it('saves the capture through the canonical proposal path and retains scanned context with owner decision guards', () => {
  const session = createBlankSession();session.paragraphs = [{ id: 'typed-body', text: 'Synthetic 123-45-6789 text.', level: 0 }];
  const round: ReviewRound = { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`, createdAt: 1,
    label: 'Typing', sourceDocumentId: 'source', ownerDocumentId: 'source', baselineDigest: 'a'.repeat(64), baseline: { ts: 1, session } };
  const draft = edit(empty(session.paragraphs[0].text), 0, 0, 'New ');
  const proposal = createSelectedTextSuggestion(round, { author: 'Synthetic', paragraphId: 'typed-body', ...draft });
  expect(proposal.changes[0]).toMatchObject({ expected: '', proposed: 'New ', target: { start: 0, end: 0 } });
  expect(reviewSuggestionText([proposal]).some(field => field.value.includes('123-45-6789'))).toBe(true);
  const state = { ...emptyReviewSuggestionState(round), proposals: [proposal] };
  expect(planReviewSuggestionDecision(round, session, state, proposal.id, 'accepted').session.paragraphs[0].text).toBe('New Synthetic 123-45-6789 text.');
  expect(session.paragraphs[0].text).toBe(draft.baseline);
  const changed = structuredClone(session);changed.paragraphs[0].text += ' Newer.';
  expect(planReviewSuggestionDecision(round, changed, state, proposal.id, 'accepted').status).toBe('stale');
});
