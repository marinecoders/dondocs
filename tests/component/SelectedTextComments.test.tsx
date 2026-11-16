import 'fake-indexeddb/auto';
import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BlockParagraphsEditor } from '@/components/editor/BlockParagraphsEditor';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { DocumentComments } from '@/components/editor/DocumentComments';

beforeEach(() => {
  useDocumentsStore.setState({ docs: {}, trash: {}, currentId: null, hydrated: true, baseline: null });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.setState({ paragraphs: [{ id: 'one', text: 'Before selected words after.', level: 0 }] });
});
async function setup() {
  render(<TooltipProvider><BlockParagraphsEditor /><DocumentComments /></TooltipProvider>);
  const dom = await waitFor(() => screen.getByRole('textbox', { name: 'Paragraph 1' }) as HTMLElement & { editor: Editor });
  return dom;
}
function post() {
  fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Chief' } });
  fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: 'Only these selected words.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
}

describe('actual paragraph editor selections create precise discussions', () => {
  it('captures native editor positions, displays exact quote, replies and resolves', async () => {
    const dom = await setup();
    expect(screen.getByRole('button', { name: 'Comment on selection in paragraph 1' })).toBeDisabled();
    act(() => { dom.editor.commands.setTextSelection({ from: 8, to: 22 }); });
    const launch = screen.getByRole('button', { name: 'Comment on selection in paragraph 1' });
    expect(launch).toBeEnabled();
    fireEvent.click(launch);
    expect(screen.getByLabelText('Comment on')).toHaveValue('selection');
    expect(screen.getByLabelText('Selected text')).toHaveTextContent('selected words');
    post();
    expect(screen.getByLabelText('Commented text')).toHaveTextContent('selected words');
    expect(useDocumentStore.getState().reviewComments!.threads[0].anchor).toMatchObject({ kind: 'range', start: 7, end: 21 });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Drafter' } });
    fireEvent.change(screen.getByLabelText('Reply', { exact: true }), { target: { value: 'Checked.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));
    expect(screen.getByText('Checked.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolved (1)' }));
    expect(screen.getByLabelText('Commented text')).toHaveTextContent('selected words');
  });
  it('cancels without a mutation, rejects stale selection and shows unsupported instructions without hover', async () => {
    const dom = await setup();
    expect(screen.getByText(/Formatting, variables and structured blocks need a paragraph comment/)).toBeVisible();
    act(() => { dom.editor.commands.setTextSelection({ from: 8, to: 22 }); });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on selection in paragraph 1' }));
    fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: 'Unposted text.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
    expect(useDocumentStore.getState().reviewComments).toBeUndefined();
    act(() => { dom.editor.commands.setTextSelection({ from: 8, to: 22 }); });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on selection in paragraph 1' }));
    fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Chief' } });
    fireEvent.change(screen.getByLabelText('Comment', { exact: true }), { target: { value: 'Pending note.' } });
    act(() => useDocumentStore.getState().updateParagraph(0, { text: 'Before changed words after.' }));
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeDisabled();
    expect(screen.getByText(/selected text changed or is unavailable/)).toBeVisible();
    expect(screen.getByLabelText('Comment', { exact: true })).toHaveValue('Pending note.');
  });
  it('reattaches one detached discussion only after reviewing old and fresh selected quotes', async () => {
    const dom = await setup();
    act(() => { dom.editor.commands.setTextSelection({ from: 8, to: 22 }); });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on selection in paragraph 1' }));
    post();
    fireEvent.click(screen.getByRole('button', { name: 'Close comments' }));
    act(() => useDocumentStore.getState().updateParagraph(0, { text: 'Before replacement words after.' }));
    act(() => { dom.editor.commands.setTextSelection({ from: 8, to: 25 }); });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on selection in paragraph 1' }));
    fireEvent.change(screen.getByLabelText('Reattach an existing detached discussion'), { target: { value: useDocumentStore.getState().reviewComments!.threads[0].id } });
    expect(screen.getByLabelText('Earlier selected text')).toHaveTextContent('selected words');
    expect(screen.getByLabelText('Selected text')).toHaveTextContent('replacement words');
    fireEvent.click(screen.getByRole('button', { name: 'Reattach selected discussion' }));
    expect(useDocumentStore.getState().reviewComments!.threads).toHaveLength(1);
    expect(screen.getByLabelText('Commented text')).toHaveTextContent('replacement words');
    expect(screen.getByText('Earlier selected targets (1)')).toBeVisible();
  });
  it('rejects marked editor text and closes a selection form across document owners', async () => {
    const dom = await setup();
    act(() => { dom.editor.commands.setTextSelection({ from: 8, to: 22 });dom.editor.commands.toggleBold(); });
    expect(screen.getByRole('button', { name: 'Comment on selection in paragraph 1' })).toBeDisabled();
    act(() => { dom.editor.commands.toggleBold();dom.editor.commands.setTextSelection({ from: 9, to: 20 }); });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on selection in paragraph 1' }));
    expect(screen.getByRole('dialog', { name: 'Document comments' })).toBeVisible();
    act(() => useDocumentsStore.getState().newDocument());
    expect(screen.queryByRole('dialog', { name: 'Document comments' })).toBeNull();
  });
});
