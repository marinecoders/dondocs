import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { captureDocumentScope, changeDocumentHistory, flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { applyCommentMutation, reviewCommentMutation } from '@/lib/reviewCommentActions';
import { captureTextRange, resolveTextRange } from '@/lib/reviewTextRanges';
import { applyMechanicalCorrections, reviewMechanicalCorrections } from '@/lib/applyMechanicalCorrections';
import { applyReferenceChange, reviewReferenceChange } from '@/lib/applyReferenceChange';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
});
afterEach(async () => { await flushDocumentWrites(); });
function setup(text: string, quote: string) {
  useDocumentStore.setState({ paragraphs: [{ id: 'body', text, level: 0 }] });
  const start = text.indexOf(quote), range = captureTextRange(useDocumentStore.getState(), 'body', start, start + quote.length)!;
  expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', range, author: 'Chief', text: 'Retain this exact discussion.' }))).toBe('applied');
}
function anchor() {
  const value = useDocumentStore.getState().reviewComments!.threads[0].anchor;
  if (value.kind !== 'range') throw new Error('Expected selected text');
  return value;
}
it('keeps a selected discussion between two independently corrected body dates current through Undo/Redo', () => {
  setup('On 15 Nov 2026 selected words by 16 Nov 2026.', 'selected words');
  const original = structuredClone(anchor()), proposal = reviewMechanicalCorrections('body', 'military');
  expect(proposal.findings).toHaveLength(2);
  expect(applyMechanicalCorrections(proposal, proposal.findings.map(value => value.id), 'military')).toBe(true);
  expect(resolveTextRange(useDocumentStore.getState(), anchor())).toMatchObject({ status: 'current', text: 'selected words', start: 20, end: 34 });
  const corrected = structuredClone(anchor());
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');expect(anchor()).toEqual(original);
  expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');expect(anchor()).toEqual(corrected);
});
it('detaches a discussion whose selected date is changed by a reviewed mechanical correction', () => {
  setup('On 15 Nov 2026 review this date.', '15 Nov 2026');
  const proposal = reviewMechanicalCorrections('body', 'military');
  expect(applyMechanicalCorrections(proposal, proposal.findings.map(value => value.id), 'military')).toBe(true);
  expect(anchor().detached).toBe(true);
});
it.each(['selected words', 'b'])('maps a reference rewrite around a discussion, and detaches an edited selected citation (%s)', quote => {
  setup('Under reference (b), selected words after.', quote);
  useDocumentStore.setState({ references: [{ letter: 'a', title: 'First reference', url: '' }, { letter: 'b', title: 'Second reference', url: '' }] });
  const original = structuredClone(anchor()), proposal = reviewReferenceChange([1, 0]);
  expect(proposal.plan.blockers).toEqual([]);expect(applyReferenceChange(proposal)).toBe(true);
  if (quote === 'b') expect(anchor().detached).toBe(true);
  else expect(resolveTextRange(useDocumentStore.getState(), anchor())).toMatchObject({ status: 'current', text: quote });
  const corrected = structuredClone(anchor());
  expect(changeDocumentHistory('undo', captureDocumentScope())).toBe('applied');expect(anchor()).toEqual(original);
  expect(changeDocumentHistory('redo', captureDocumentScope())).toBe('applied');expect(anchor()).toEqual(corrected);
});
