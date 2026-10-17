// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditorSidebar } from '@/components/layout/EditorSidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';

describe('Recents header', () => {
  it('focuses the document filter and returns focus when Escape clears it', async () => {
    useUIStore.setState({ isMobile: false, sidebarCollapsed: false });
    render(<TooltipProvider><EditorSidebar /></TooltipProvider>);
    const toggle = screen.getByRole('button', { name: 'Filter documents' });
    await userEvent.click(toggle);
    const filter = screen.getByRole('textbox', { name: 'Search documents' });
    expect(filter).toHaveFocus();
    await userEvent.type(filter, 'sample');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Search documents' })).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
    await userEvent.click(toggle);
    expect(screen.getByRole('textbox', { name: 'Search documents' })).toHaveValue('');
  });
  it('keeps document creation labeled and available without opening a document', () => {
    render(
      <TooltipProvider>
        <EditorSidebar />
      </TooltipProvider>
    );

    const button = screen.getByRole('button', { name: 'New document' });

    expect(button).toHaveAccessibleName('New document');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
  });
  it('identifies incomplete form sections in the optional outline', () => {
    useUIStore.setState({ sidebarOutlineVisible: true, validationVisible: true });
    useDocumentStore.setState({ documentCategory: 'forms', formType: 'navmc_10274' });
    useFormStore.getState().setNavmc10274Field('natureOfAction', '');
    render(<TooltipProvider><EditorSidebar /></TooltipProvider>);
    expect(screen.getByRole('button', { name: 'Action details needs attention' })).toBeInTheDocument();
    act(() => useFormStore.getState().setNavmc10274Field('natureOfAction', 'Training review'));
    expect(screen.getByRole('button', { name: 'Action details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Action details needs attention' })).not.toBeInTheDocument();
  });
});
it('focuses desktop rename after its menu closes and cancels without changing the draft', async () => {
  useUIStore.setState({ isMobile: false, sidebarCollapsed: false, sidebarOutlineVisible: false });
  useDocumentsStore.setState({ currentId: null, docs: {}, hydrated: true });
  useDocumentsStore.getState().newDocument();
  useDocumentStore.getState().setField('subject', 'Desktop rename QA');
  useDocumentsStore.getState().saveCurrent();
  const id = useDocumentsStore.getState().currentId!;
  const title = useDocumentsStore.getState().docs[id].meta.title;
  render(<TooltipProvider><EditorSidebar /></TooltipProvider>);
  await userEvent.click(screen.getByRole('button', { name: `Actions for ${title}` }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  const input = screen.getByRole('textbox', { name: `Rename ${title}` });
  expect(input).toHaveFocus();
  await userEvent.type(input, ' canceled{Escape}');
  await waitFor(() => expect(screen.getByRole('button', { name: `Actions for ${title}` })).toHaveFocus());
  expect(useDocumentsStore.getState().docs[id].meta.title).toBe(title);
});
