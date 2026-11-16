import { describe, expect, it, vi } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { captureTextRange, resolveTextRange } from '@/lib/reviewTextRanges';
import { applyReviewStructure, captureReviewStructure, inspectReviewStructure, type CaptureReviewStructureInput } from '@/lib/reviewStructureSuggestions';
import { inspectReviewStructureReconciliation } from '@/lib/reconcileReviewStructure';
function fixture() {
  const session = createBlankSession();
  session.paragraphs = [{ id: 'first', text: 'First body.', level: 0 }, { id: 'second', text: 'Second body.', level: 0 }, { id: 'tail', text: 'Tail body.', level: 0 }];
  session.reviewComments = { version: 3, threads: [{ id: crypto.randomUUID(), anchor: captureTextRange(session, 'second', 0, 6)!, resolved: false,
    messages: [{ id: crypto.randomUUID(), author: 'Reviewer', text: 'Keep this discussion.', createdAt: '2026-11-15T00:00:00Z' }] }] };
  return session;
}
const operations: CaptureReviewStructureInput[] = [
  { kind: 'insert-paragraph', index: 1, text: 'Inserted body.', level: 0, paragraphId: 'fresh' },
  { kind: 'delete-paragraph', paragraphId: 'second' },
  { kind: 'split-paragraph', paragraphId: 'second', splitAt: 7, newParagraphId: 'fresh' },
  { kind: 'join-paragraphs', paragraphId: 'first', nextParagraphId: 'second', separator: ' ' },
  { kind: 'move-paragraph', paragraphId: 'second', destinationId: 'tail', placement: 'after' },
];
describe('structural review inspection', () => {
  it.each(operations)('inspects $kind without deriving a writable session or comment mappings', operation => {
    const source = fixture(), target = captureReviewStructure(source, operation), before = structuredClone(source);
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      expect(inspectReviewStructure(source, target)).toBe(true);
      expect(inspectReviewStructureReconciliation(source, target).kind).toBe('unchanged');
      expect(clone.mock.calls.some(([value]) => value === source)).toBe(false);
      expect(source).toEqual(before);
    } finally { clone.mockRestore(); }
  });
  it('retains stale, child, reserved-identity and removed-constituent guards in the read-only path', () => {
    const source = fixture(), split = captureReviewStructure(source, { kind: 'split-paragraph', paragraphId: 'second', splitAt: 7, newParagraphId: 'fresh' });
    expect(inspectReviewStructure(source, split, 'forward', ['fresh'])).toBe(false);
    source.paragraphs[1].text = 'Newer body.'; expect(inspectReviewStructure(source, split)).toBe(false);
    source.paragraphs[1].text = 'Second body.'; source.paragraphs[2].level = 1; expect(inspectReviewStructure(source, split)).toBe(false);
    source.paragraphs[2].level = 0;
    const join = captureReviewStructure(source, { kind: 'join-paragraphs', paragraphId: 'first', nextParagraphId: 'second', separator: ' ' });
    source.paragraphs.splice(1, 1); expect(inspectReviewStructure(source, join)).toBe(false);
    expect(inspectReviewStructureReconciliation(source, join)).toMatchObject({ kind: 'missing-target', canResolve: false });
  });
  it('continues to clone and map exact selected text when the inspected join is written', () => {
    const source = fixture(), target = captureReviewStructure(source, { kind: 'join-paragraphs', paragraphId: 'first', nextParagraphId: 'second', separator: ' ' });
    expect(inspectReviewStructure(source, target)).toBe(true);
    const applied = applyReviewStructure(source, target), anchor = applied.reviewComments!.threads[0].anchor;
    expect(applied).not.toBe(source); expect(source.paragraphs).toHaveLength(3); expect(applied.paragraphs).toHaveLength(2);
    expect(anchor).toMatchObject({ paragraphId: 'second', tracking: { paragraphId: 'first', start: 12, end: 18 } });
    expect(resolveTextRange(applied, anchor as never)).toMatchObject({ status: 'current', text: 'Second' });
    expect(source.reviewComments!.threads[0].anchor).not.toHaveProperty('tracking');
  });
});
