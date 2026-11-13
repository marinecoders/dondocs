import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { DocumentComments } from '@/components/editor/DocumentComments';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore, captureDocumentScope, changeDocumentHistory } from '@/stores/documentsStore';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Original subject');
});
function open() {
  render(<DocumentComments />);
  fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
}
function comment(text = 'Check this subject. 😀') {
  fireEvent.change(screen.getByLabelText('Comment on'), { target: { value: 'subject' } });
  fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Chief' } });
  fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
}

describe('native document comments', () => {
  it('adds field and whole-document comments with readable labels and retained text', () => {
    open();
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeDisabled();
    comment();
    expect(screen.getByRole('article', { name: 'Comment on Subject' })).toHaveTextContent('Check this subject. 😀');
    expect(screen.getByRole('status')).toHaveTextContent('Comment changes saved');
    expect(screen.getByRole('button', { name: 'Comments (1)', hidden: true })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Drafter' } });
    fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: 'Whole-letter note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(screen.getByRole('article', { name: 'Comment on Whole document' })).toHaveTextContent('Whole-letter note');
  });
  it('replies, edits, resolves, reopens and deletes comments', () => {
    open();comment();
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Drafter' } });
    fireEvent.change(screen.getByLabelText('Reply', { exact: true }), { target: { value: 'Corrected.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));
    expect(screen.getByRole('article')).toHaveTextContent('Corrected.');
    fireEvent.click(screen.getByRole('button', { name: 'Edit reply by Drafter' }));
    fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: 'Corrected today.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));
    expect(screen.getByRole('article')).toHaveTextContent('Corrected today.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete reply by Drafter' }));
    expect(screen.getByRole('article')).not.toHaveTextContent('Corrected today.');
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.queryByRole('article')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resolved (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete thread' }));
    expect(screen.queryByRole('article')).toBeNull();
  });
  it('retains entered comment text after stale changes and requires reviewing the new draft', () => {
    open();
    fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Chief' } });
    fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: 'Pending note' } });
    act(() => useDocumentStore.getState().setField('subject', 'Later subject'));
    expect(screen.getByRole('alert')).toHaveTextContent('Your comment text is still here');
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeDisabled();
    expect(screen.getByLabelText('Comment', { exact: true })).toHaveValue('Pending note');
    fireEvent.click(screen.getByRole('button', { name: 'Use current draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(screen.getByRole('article')).toHaveTextContent('Pending note');
  });
  it('shows original and current field values after edits, and preserves unavailable context', () => {
    open();comment();
    act(() => useDocumentStore.getState().setField('subject', 'Later subject'));
    const thread = screen.getByRole('article');
    expect(thread).toHaveTextContent('changed after the comment');
    fireEvent.click(within(thread).getByText('Field context'));
    expect(thread).toHaveTextContent('Original subject');
    expect(thread).toHaveTextContent('Later subject');
    act(() => useDocumentStore.setState({ formData: {} }));
    expect(thread).toHaveTextContent('field is unavailable');
    expect(thread).toHaveTextContent('Original subject');
  });
  it('updates the comment list through Undo and Redo', () => {
    open();comment();
    const scope = captureDocumentScope();
    act(() => { expect(changeDocumentHistory('undo', scope)).toBe('applied'); });
    expect(screen.queryByRole('article')).toBeNull();
    act(() => { expect(changeDocumentHistory('redo', scope)).toBe('applied'); });
    expect(screen.getByRole('article')).toHaveTextContent('Check this subject');
  });
  it('does not carry an unsaved editor or review threads into another document', () => {
    open();comment();
    fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: 'Unsent note' } });
    act(() => useDocumentsStore.getState().newDocument());
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.getByLabelText('Comment', { exact: true })).toHaveValue('');
    expect(useDocumentStore.getState().reviewComments).toBeUndefined();
  });
  it('keeps unsupported form and publication workflows free of inactive controls', () => {
    useDocumentStore.setState({ documentCategory: 'forms' });
    const view = render(<DocumentComments />);
    expect(screen.queryByRole('button', { name: 'Comments' })).toBeNull();
    act(() => useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'i_type' }));
    view.rerender(<DocumentComments />);
    expect(screen.queryByRole('button', { name: 'Comments' })).toBeNull();
  });
});
