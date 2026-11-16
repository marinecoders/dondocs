import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { flushDocumentWrites, useDocumentsStore } from '@/stores/documentsStore';
import { applyCommentMutation, reviewCommentMutation } from '@/lib/reviewCommentActions';
import { captureTextRange, resolveTextRange } from '@/lib/reviewTextRanges';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setDocType('new_page_endorsement');
  useDocumentStore.setState({
    paragraphs: [{ id: 'body', level: 0, text: 'Under reference (a), retain these words.' }],
    references: [{ letter: 'a', title: 'Synthetic reference', url: '' }],
  });
});
afterEach(async () => { await flushDocumentWrites(); });
function add(quote: string) {
  const state = useDocumentStore.getState(), start = state.paragraphs[0].text.indexOf(quote);
  const range = captureTextRange(state, 'body', start, start + quote.length)!;
  expect(range).not.toBeNull();
  expect(applyCommentMutation(reviewCommentMutation({ kind: 'add', range, author: 'Synthetic reviewer', text: 'Review this span.' }))).toBe('applied');
}
function anchor() {
  const value = useDocumentStore.getState().reviewComments!.threads[0].anchor;
  if (value.kind !== 'range') throw new Error('Expected range');
  return value;
}
it('maps an outside discussion when the endorsement first-reference field renumbers body citations', () => {
  add('retain these words');
  useDocumentStore.getState().setField('startingReferenceLetter', 'b');
  expect(useDocumentStore.getState().paragraphs[0].text).toBe('Under reference (b), retain these words.');
  expect(resolveTextRange(useDocumentStore.getState(), anchor())).toMatchObject({ status: 'current', text: 'retain these words' });
});
it('keeps a touched citation discussion detached when the author changes the first-reference field back', () => {
  add('a');
  useDocumentStore.getState().setField('startingReferenceLetter', 'b');
  expect(useDocumentStore.getState().paragraphs[0].text).toBe('Under reference (b), retain these words.');
  expect(anchor().detached).toBe(true);
  useDocumentStore.getState().setField('startingReferenceLetter', 'a');
  expect(useDocumentStore.getState().paragraphs[0].text).toBe('Under reference (a), retain these words.');
  expect(resolveTextRange(useDocumentStore.getState(), anchor()).status).toBe('changed');
});
