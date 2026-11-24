import { describe, expect, it } from 'vitest';
import { mapStructuralRangeComments, normalizeReturnedRangeComments, transformRangeComments } from '@/lib/reviewCommentRanges';
import { captureTextRange, resolveTextRange } from '@/lib/reviewTextRanges';
import { reviewCommentsSchema, type ReviewComments } from '@/lib/reviewComments';
import { paragraphCommentIds } from '@/lib/paragraphIdentity';
import { mergeReturnedComments } from '@/lib/reviewCommentMerge';
const before = { id: 'left', text: 'Left selected right words.', level: 0 };
const splitAt = 14;
const after = [{ ...before, text: before.text.slice(0, splitAt) }, { id: 'right', text: before.text.slice(splitAt), level: 0 }];
const source = { documentCategory: 'correspondence' as const, docType: 'naval_letter', formData: {}, paragraphs: [before] };
const comments = (): ReviewComments => ({ version: 3, threads: [[0, 4], [14, 19], [5, 19]].map(([start, end]) => ({
  id: crypto.randomUUID(), anchor: captureTextRange(source, 'left', start, end)!, resolved: false,
  messages: [{ id: crypto.randomUUID(), author: 'Reviewer', text: 'Discuss this.', createdAt: '2026-11-15T12:00:00.000Z' }],
})) });
const spans = [{ fromParagraphId: 'left', fromStart: 0, fromEnd: splitAt, toParagraphId: 'left', toStart: 0 },
  { fromParagraphId: 'left', fromStart: splitAt, fromEnd: before.text.length, toParagraphId: 'right', toStart: 0 }];

describe('explicit accepted structural comment mappings', () => {
  it('keeps identities and immutable original quotes, maps wholly contained spans, detaches crossings', () => {
    const original = comments(), mapped = mapStructuralRangeComments(original, [before], after, spans)!;
    expect(mapped.threads.map(thread => thread.id)).toEqual(original.threads.map(thread => thread.id));
    expect(mapped.threads.map(thread => thread.messages)).toEqual(original.threads.map(thread => thread.messages));
    expect(mapped.threads[1].anchor).toMatchObject({ paragraphId: 'left', context: before.text, start: 14, end: 19,
      tracking: { paragraphId: 'right', context: 'right words.', start: 0, end: 5 } });
    expect(resolveTextRange({ ...source, paragraphs: after }, mapped.threads[1].anchor as never)).toMatchObject({ status: 'current', text: 'right' });
    expect(mapped.threads[2].anchor).toMatchObject({ detached: true, context: before.text, start: 5, end: 19 });
    expect(reviewCommentsSchema.parse(JSON.parse(JSON.stringify(mapped)))).toEqual(mapped);
    expect(paragraphCommentIds(mapped)).toContain('right');
  });
  it('tracks later editing on the known new node and joins back with the known delta', () => {
    const mapped = mapStructuralRangeComments(comments(), [before], after, spans)!;
    const edited = transformRangeComments(mapped, after[1], { ...after[1], text: after[1].text + ' Later.' })!;
    expect(edited.threads[1].anchor).toMatchObject({ tracking: { paragraphId: 'right', start: 0, end: 5, context: 'right words. Later.' } });
    const joined = mapStructuralRangeComments(mapped, after, [before], [
      { fromParagraphId: 'left', fromStart: 0, fromEnd: splitAt, toParagraphId: 'left', toStart: 0 },
      { fromParagraphId: 'right', fromStart: 0, fromEnd: after[1].text.length, toParagraphId: 'left', toStart: splitAt },
    ])!;
    expect(joined.threads[1].anchor).toEqual(comments().threads[1].anchor);
    expect(joined.threads[2].anchor).toMatchObject({ detached: true });
  });
  it('preserves deliberate history and owner mapping on returns, discards incoming runtime authority', () => {
    const baseline = comments();
    baseline.threads[1].anchorHistory = [{ anchor: structuredClone(baseline.threads[0].anchor) as never, reattachedAt: '2026-11-15T13:00:00.000Z' }];
    const owner = mapStructuralRangeComments(baseline, [before], after, spans)!;
    expect(owner.threads[1].anchorHistory).toEqual(baseline.threads[1].anchorHistory);
    const incoming = structuredClone(baseline);
    if (incoming.threads[1].anchor.kind === 'range') incoming.threads[1].anchor.tracking = { paragraphId: 'foreign', context: 'right', start: 0, end: 5 };
    incoming.threads[1].messages.push({ id: crypto.randomUUID(), author: 'Reviewer', text: 'Reply', createdAt: '2026-11-15T14:00:00.000Z' });
    expect(mergeReturnedComments(baseline, owner, incoming).comments!.threads[1].anchor).toEqual(owner.threads[1].anchor);
    const normalized = normalizeReturnedRangeComments(source, { ...source, paragraphs: after }, incoming)!;
    expect(normalized.threads[1].anchor).toMatchObject({ detached: true });
    expect(normalized.threads[1].anchor).not.toHaveProperty('tracking');
  });
  it('never heals detached ranges or maps ambiguous/changed text', () => {
    const original = comments();
    if (original.threads[1].anchor.kind === 'range') original.threads[1].anchor.detached = true;
    expect(mapStructuralRangeComments(original, [before], after, spans)!.threads[1].anchor).toEqual(original.threads[1].anchor);
    expect(mapStructuralRangeComments(comments(), [{ ...before, text: 'changed' }], after, spans)!.threads[0].anchor).toMatchObject({ detached: true });
    expect(mapStructuralRangeComments(comments(), [before], after, [...spans, spans[0]])!.threads[0].anchor).toMatchObject({ detached: true });
  });

  it('maps only unambiguous, unaffected selections from a Word return', () => {
    const newer = { ...source, paragraphs: [{ ...before, text: 'Left revised right words.' }] };
    const returned = comments();
    const ordinary = normalizeReturnedRangeComments(source, newer, returned)!;
    expect(ordinary.threads[1].anchor).toMatchObject({ detached: true });
    const word = normalizeReturnedRangeComments(source, newer, returned, true)!;
    expect(resolveTextRange(newer, word.threads[1].anchor as never)).toMatchObject({ status: 'current', text: 'right' });
    expect(word.threads[2].anchor).toMatchObject({ detached: true });
  });
});
