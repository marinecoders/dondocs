import { expect, it, vi } from 'vitest';
import * as paragraphLabel from '@/services/latex/paragraphLabel';
import { createBlankSession } from '@/stores/documentStore';
import { sessionSchema } from '@/lib/sharedSession';
import { captureReviewStructure } from '@/lib/reviewStructureSuggestions';
import { captureReconciledReviewStructure } from '@/lib/reconcileReviewStructure';

it('keeps whole-document outline work bounded as a reconciled move corridor grows', () => {
  const source = createBlankSession();
  source.paragraphs = Array.from({ length: 500 }, (_, index) => ({ id: `cost-${index}`, text: `Synthetic paragraph ${index}`, level: 0 }));
  expect(sessionSchema.safeParse(source).success).toBe(true);
  const narrow = captureReviewStructure(source, { kind: 'move-paragraph', paragraphId: 'cost-0', destinationId: 'cost-1', placement: 'after' });
  const wide = captureReviewStructure(source, { kind: 'move-paragraph', paragraphId: 'cost-0', destinationId: 'cost-99', placement: 'after' });
  source.paragraphs[0].header = 'New current heading';
  const outline = vi.spyOn(paragraphLabel, 'outlineParagraphs');
  try {
    captureReconciledReviewStructure(source, narrow);
    const narrowScans = outline.mock.calls.length;
    outline.mockClear();
    const resolved = captureReconciledReviewStructure(source, wide);
    // Reconciliation may index the current outline, but must not rebuild the
    // complete document's hierarchy for every node in its guarded corridor.
    expect(outline.mock.calls.length).toBeLessThanOrEqual(narrowScans + 2);
    expect(resolved.operation.before).toEqual(source.paragraphs.slice(0, 100));
    expect(resolved.operation.after).toEqual([...source.paragraphs.slice(1, 100), source.paragraphs[0]]);
    expect(source.paragraphs[0]).toEqual({ id: 'cost-0', text: 'Synthetic paragraph 0', level: 0, header: 'New current heading' });
  } finally { outline.mockRestore(); }
});
