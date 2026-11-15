import { describe, expect, it } from 'vitest';
import { reviewCommentsSchema, type ReviewComments } from '@/lib/reviewComments';
import { mergeReturnedComments } from '@/lib/reviewCommentMerge';
import { feedbackCategoryLabel, matchesFeedbackFilter } from '@/lib/reviewFeedback';
import { createReviewSuggestion, emptyReviewSuggestionState, appendReviewSuggestions } from '@/lib/reviewSuggestions';
import { parseReviewReturn, createSuggestionReviewReturn } from '@/lib/reviewReturns';
import { getSerializedSession } from '@/stores/documentStore';
import { canonicalReviewPayload, type ReviewRound } from '@/lib/reviewRounds';

function comments(): ReviewComments {
  return { version: 1, threads: [{ id: crypto.randomUUID(), anchor: { kind: 'document' }, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Example reviewer', text: 'Check this.', createdAt: '2026-11-15T00:00:00Z' }] }] };
}

function round(): ReviewRound {
  const session = getSerializedSession();
  session.docType = 'naval_letter';
  session.documentCategory = 'correspondence';
  session.formData.to = 'Original recipient';
  return { kind: 'dondocs-review-round', version: 1, id: `review_${crypto.randomUUID()}`,
    label: 'Training review', createdAt: session.timestamp, sourceDocumentId: 'example', baselineDigest: 'a'.repeat(64),
    baseline: { ts: session.timestamp, session } };
}

describe('review feedback categories', () => {
  it('keeps legacy comment bytes unchanged and reports missing categories explicitly', () => {
    const legacy = comments();
    expect(canonicalReviewPayload(reviewCommentsSchema.parse(legacy))).toBe(canonicalReviewPayload(legacy));
    expect(feedbackCategoryLabel()).toBe('Unclassified');
    expect(matchesFeedbackFilter(undefined, 'unclassified')).toBe(true);
    expect(matchesFeedbackFilter(undefined, 'required-correction')).toBe(false);
  });

  it('rejects unknown categories rather than importing unchecked workflow claims', () => {
    const value = comments();
    expect(reviewCommentsSchema.safeParse({ ...value, threads: [{ ...value.threads[0], category: 'approved' }] }).success).toBe(false);
  });

  it('merges an independent category change and reply', () => {
    const base = comments();
    const local = structuredClone(base);
    const returned = structuredClone(base);
    local.threads[0].category = 'question';
    returned.threads[0].messages.push({ id: crypto.randomUUID(), author: 'Example chief', text: 'A reply.', createdAt: '2026-11-15T01:00:00Z' });
    const result = mergeReturnedComments(base, local, returned);
    expect(result.status).toBe('ready');
    expect(result.comments?.threads[0].category).toBe('question');
    expect(result.comments?.threads[0].messages).toHaveLength(2);
  });

  it('requires an explicit choice for competing category changes and is idempotent', () => {
    const base = comments();
    const local = structuredClone(base);
    const returned = structuredClone(base);
    local.threads[0].category = 'question';
    returned.threads[0].category = 'required-correction';
    const pending = mergeReturnedComments(base, local, returned);
    expect(pending.status).toBe('conflict');
    expect(pending.conflicts[0].kind).toBe('category');
    const chosen = mergeReturnedComments(base, local, returned, { [pending.conflicts[0].id]: 'returned' });
    expect(chosen.comments?.threads[0].category).toBe('required-correction');
    expect(mergeReturnedComments(base, chosen.comments, returned).comments).toEqual(chosen.comments);
  });

  it('retains proposal and discussion categories through portable returns and repeated import', () => {
    const baseline = round();
    const proposal = createReviewSuggestion(baseline, { author: 'Example chief', label: 'Recipient correction', category: 'required-correction',
      changes: [{ target: { kind: 'field', docType: 'naval_letter', field: 'to' }, proposed: 'New recipient' }] });
    const discussion = comments();
    discussion.threads[0].category = 'question';
    const payload = createSuggestionReviewReturn(baseline.id, baseline.baselineDigest, discussion, [proposal], { marking: 'UNCLASSIFIED', customMarkings: [] });
    const returned = parseReviewReturn(JSON.parse(JSON.stringify(payload)));
    expect(returned.comments?.threads[0].category).toBe('question');
    if (returned.version !== 2) throw new Error('Expected suggestions.');
    expect(returned.proposals[0].category).toBe('required-correction');
    const once = appendReviewSuggestions(baseline, emptyReviewSuggestionState(baseline), returned.proposals);
    expect(appendReviewSuggestions(baseline, once, returned.proposals)).toEqual(once);
    expect(baseline.baseline.session.formData.to).toBe('Original recipient');
  });
  it('preserves a cleared category and independent reply, but requires a choice after deletion', () => {
    const base = comments();
    base.threads[0].category = 'edit';
    const local = structuredClone(base);
    delete local.threads[0].category;
    const returned = structuredClone(base);
    returned.threads[0].messages.push({ id: crypto.randomUUID(), author: 'Example chief', text: 'Independent reply.', createdAt: '2026-11-15T01:00:00Z' });
    const combined = mergeReturnedComments(base, local, returned);
    expect(combined.status).toBe('ready');
    expect(combined.comments?.threads[0].category).toBeUndefined();
    expect(combined.comments?.threads[0].messages).toHaveLength(2);
    returned.threads[0].category = 'question';
    const deleted = mergeReturnedComments(base, undefined, returned);
    expect(deleted.status).toBe('conflict');
    expect(deleted.conflicts[0].kind).toBe('thread');
    const kept = mergeReturnedComments(base, undefined, returned, { [deleted.conflicts[0].id]: 'current' });
    expect(kept.comments).toBeUndefined();
  });

});
