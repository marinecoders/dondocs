// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BlockParagraphsEditor } from '@/components/editor/BlockParagraphsEditor';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';

const renderEditor = () => render(<TooltipProvider><BlockParagraphsEditor /></TooltipProvider>);

describe('publication authoring', () => {
  beforeEach(() => {
    useDocumentStore.getState().resetForm();
    useDocumentStore.getState().setDocType('i_type');
  });
  it('keeps an explicitly selected section when its title changes', () => {
    useDocumentStore.setState({ paragraphs: [{ level: 0, text: '', header: 'Procedures' }] });
    renderEditor();
    fireEvent.change(screen.getByLabelText('Publication section 1'), { target: { value: 'procedures' } });
    fireEvent.change(screen.getByPlaceholderText('Heading'), { target: { value: 'Inspect the bracket' } });
    expect(useDocumentStore.getState().paragraphs[0]).toMatchObject({ publicationSection: 'procedures', header: 'Inspect the bracket' });
  });
  it('adds and removes table footnotes without changing table rows', () => {
    useDocumentStore.setState({ paragraphs: [{ level: 0, text: '', header: 'Materiel Required', tableKey: 'materielRequired' }] });
    renderEditor();
    fireEvent.click(screen.getByText('Add table footnote'));
    fireEvent.change(screen.getByLabelText('Table footnote 1'), { target: { value: 'Install two bolts.' } });
    expect(useDocumentStore.getState().paragraphs[0].tableFootnotes).toEqual([{ id: '1', text: 'Install two bolts.' }]);
    fireEvent.click(screen.getByLabelText('Remove footnote 1'));
    expect(useDocumentStore.getState().paragraphs[0].tableFootnotes).toEqual([]);
  });
  it('updates a reference chip after its target moves and reports a deleted target', async () => {
    const id = 'ABCDEF0123456789ABCDEF0123456789';
    useDocumentStore.setState({ paragraphs: [
      { level: 0, text: `See {{PUBREF_P_${id}}}.`, header: 'Purpose' },
      { level: 0, text: 'Inspect the bracket.', header: 'Inspection', referenceId: id },
    ] });
    const { container } = renderEditor();
    const chip = () => container.querySelector(`[data-name="PUBREF_P_${id}"]`)?.textContent;
    await waitFor(() => expect(chip()).toContain('paragraph 2'));
    act(() => useDocumentStore.getState().reorderParagraphs(1, 0));
    await waitFor(() => expect(chip()).toContain('paragraph 1'));
    act(() => useDocumentStore.getState().removeParagraph(0));
    await waitFor(() => expect(chip()).toContain('Missing reference'));
  });
});
