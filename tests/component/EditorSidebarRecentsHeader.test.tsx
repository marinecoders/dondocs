// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { EditorSidebar } from '@/components/layout/EditorSidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores/uiStore';
import { useDocumentStore } from '@/stores/documentStore';
import { useFormStore } from '@/stores/formStore';

describe('Recents header', () => {
  it('keeps document creation labeled and available without opening a document', () => {
    render(
      <TooltipProvider>
        <EditorSidebar />
      </TooltipProvider>
    );

    const button = screen.getByRole('button', { name: 'New document' });

    expect(button).toHaveTextContent('New document');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
  });
  it('identifies incomplete form sections in the optional outline', () => {
    useUIStore.setState({ sidebarOutlineVisible: true, validationVisible: true });
    useDocumentStore.setState({ documentCategory: 'forms', formType: 'navmc_10274' });
    useFormStore.getState().setNavmc10274Field('natureOfAction', '');
    render(<TooltipProvider><EditorSidebar /></TooltipProvider>);
    expect(screen.getByRole('button', { name: 'Counseling content needs attention' })).toBeInTheDocument();
    act(() => useFormStore.getState().setNavmc10274Field('natureOfAction', 'Training review'));
    expect(screen.getByRole('button', { name: 'Counseling content' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Counseling content needs attention' })).not.toBeInTheDocument();
  });
});
