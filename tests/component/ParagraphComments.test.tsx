import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ParagraphCommentsButton } from '@/components/editor/ParagraphCommentsButton';
import { DocumentComments } from '@/components/editor/DocumentComments';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { freshParagraphs } from '@/lib/paragraphIdentity';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ paragraphs: freshParagraphs([{ text: 'First paragraph', level: 0 }, { text: 'Second paragraph 😀', level: 0 }]) });
});

function post() {
  fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Chief' } });
  fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: 'Please check this paragraph.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
}

describe('paragraph comment entry and context', () => {
  it('opens directly on the selected node and reports its current position after movement', () => {
    const id = useDocumentStore.getState().paragraphs[1].id!;
    render(<ParagraphCommentsButton paragraphId={id} index={1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on paragraph 2' }));
    expect(screen.getByLabelText('Comment on')).toHaveValue(`paragraph:${id}`);
    post();
    expect(screen.getByRole('article', { name: 'Comment on Paragraph 2' })).toHaveTextContent('Please check this paragraph.');
    act(() => useDocumentStore.getState().reorderParagraphs(1, 0));
    expect(screen.getByRole('article', { name: 'Comment on Paragraph 1' })).toHaveTextContent('Please check this paragraph.');
    expect(screen.getByRole('button', { name: 'Go to paragraph' })).toBeEnabled();
  });

  it('shows deleted-node context and never offers navigation to a replacement paragraph', () => {
    render(<DocumentComments />);
    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    const id = useDocumentStore.getState().paragraphs[1].id!;
    fireEvent.change(screen.getByLabelText('Comment on'), { target: { value: `paragraph:${id}` } });
    post();
    act(() => {
      useDocumentStore.getState().removeParagraph(1);
      useDocumentStore.getState().addParagraph('Second paragraph 😀', 0, 0);
    });
    const thread = screen.getByRole('article', { name: 'Comment on Deleted or unavailable paragraph' });
    expect(thread).toHaveTextContent('earlier context is kept');
    expect(thread).toHaveTextContent('Second paragraph 😀');
    expect(screen.queryByRole('button', { name: 'Go to paragraph' })).toBeNull();
  });

  it('preserves pending text but disables posting when its selected paragraph disappears', () => {
    render(<DocumentComments />);
    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    const id = useDocumentStore.getState().paragraphs[1].id!;
    fireEvent.change(screen.getByLabelText('Comment on'), { target: { value: `paragraph:${id}` } });
    fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Chief' } });
    fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: 'Pending review.' } });
    act(() => useDocumentStore.getState().removeParagraph(1));
    expect(screen.getByLabelText('Comment', { exact: true })).toHaveValue('Pending review.');
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeDisabled();
    expect(screen.getAllByRole('alert').some(alert => alert.textContent?.includes('paragraph is unavailable'))).toBe(true);
  });

  it('closes a paragraph-launched editor on owner switch instead of reusing its target', () => {
    const id = useDocumentStore.getState().paragraphs[0].id!;
    render(<ParagraphCommentsButton paragraphId={id} index={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Comment on paragraph 1' }));
    fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: 'Old document note.' } });
    act(() => useDocumentsStore.getState().newDocument());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useDocumentStore.getState().reviewComments).toBeUndefined();
  });

  it('keeps very large paragraph targets explicit instead of capturing truncated context', () => {
    const id = useDocumentStore.getState().paragraphs[0].id!;
    act(() => useDocumentStore.getState().updateParagraph(0, { text: 'x'.repeat(20_001) }));
    render(<ParagraphCommentsButton paragraphId={id} index={0} />);
    expect(screen.getByRole('button', { name: 'Comment on paragraph 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Comment on paragraph 1' })).toHaveAttribute('title', expect.stringContaining('20,000'));
  });
});
