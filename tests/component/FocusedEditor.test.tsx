import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormPanel } from '@/components/layout/FormPanel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';
import { useUIStore } from '@/stores/uiStore';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useDocumentsStore.setState({ currentId: 'draft-one', docs: {} });
  useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'naval_letter', paragraphs: [{ text: 'Keep this paragraph.', level: 0 }] });
  useUIStore.setState({ documentPositions: {}, isMobile: false });
  useEditorOutlineStore.setState({ pendingJump: null, activeId: null });
});

const openEditor = () => render(<TooltipProvider><FormPanel /></TooltipProvider>);
const selectSection = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Document section' }), { target: { value } });

describe('focused workspace editor', () => {
  it('preserves edits and mounted fields while Contents changes the visible section', async () => {
    openEditor();
    const subject = screen.getByRole('textbox', { name: 'Subject' });
    fireEvent.change(subject, { target: { value: 'APPOINTMENT' } });
    selectSection('signature');
    expect(subject).not.toBeVisible();
    expect(subject).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById('sec-signature')).toHaveFocus());
    expect(screen.getByLabelText('First Name')).toBeVisible();
    selectSection('body');
    expect(screen.getByRole('textbox', { name: 'Subject' })).toBe(subject);
    expect(subject).toHaveValue('APPOINTMENT');
    expect(screen.getByRole('textbox', { name: 'Paragraph 1' })).toHaveTextContent('Keep this paragraph.');
  });

  it('remembers each document’s section and opens a hidden section from a search result', async () => {
    openEditor();
    selectSection('signature');
    act(() => useDocumentsStore.setState({ currentId: 'draft-two' }));
    expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('body');
    selectSection('references');
    act(() => useDocumentsStore.setState({ currentId: 'draft-one' }));
    expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('signature');
    act(() => useEditorOutlineStore.getState().requestJump('draft-one', 'addressing'));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('addressing'));
    expect(document.getElementById('sec-addressing')).toBeVisible();
    await waitFor(() => expect(document.getElementById('sec-addressing')).toHaveFocus());
  });

  it.each(['navmc_10274', 'navmc_118_11'] as const)('keeps all %s sections reachable without showing the entire form at once', (formType) => {
    useDocumentStore.setState({ documentCategory: 'forms', formType });
    openEditor();
    expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('content');
    expect(document.getElementById('sec-content')).toBeVisible();
    expect(document.getElementById('sec-signatures')).not.toBeVisible();
    selectSection('signatures');
    expect(document.getElementById('sec-signatures')).toBeVisible();
    expect(document.getElementById('sec-content')).not.toBeVisible();
    selectSection('type');
    expect(document.getElementById('sec-type')).toBeVisible();
    expect(document.getElementById('sec-signatures')).not.toBeVisible();
  });
});
