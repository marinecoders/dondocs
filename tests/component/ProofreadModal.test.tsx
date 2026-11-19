import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProofreadModal } from '@/components/modals/ProofreadModal';
import { ProofreadButton } from '@/components/ProofreadButton';
import { FormPanel } from '@/components/layout/FormPanel';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useUIStore } from '@/stores/uiStore';
import { useEditorOutlineStore } from '@/stores/editorOutlineStore';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useDocumentsStore.setState({ currentId: 'proofread-owner', activationEpoch: 1, docs: {}, trash: {} });
  useDocumentStore.setState({ documentCategory: 'correspondence', documentMode: 'compliant', docType: 'naval_letter',
    formData: { unitLine1: 'Synthetic unit', from: 'Commanding Officer', to: 'Director', subject: 'EXAMPLE', sigLast: 'EXAMPLE', date: '2026-11-12' },
    paragraphs: [{ id: 'proofread-body', text: 'A synthetic paragraph.', level: 0 }], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {} });
  useUIStore.setState({ proofreadOpen: false, editorLayout: 'focused', documentPositions: {}, isMobile: false });
  useEditorOutlineStore.setState({ activeId: null, pendingJump: null });
});
afterEach(cleanup);

function view(editor = false) {
  return render(<TooltipProvider>{editor && <FormPanel />}<ProofreadButton /><ProofreadModal /></TooltipProvider>);
}

describe('proofread entry and current-draft review', () => {
  it('keeps the count and displayed findings synchronized as actual fields change', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Proofread: 1 finding' }));
    const dialog = screen.getByRole('dialog', { name: 'Proofread' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('1 finding to review');
    expect(within(dialog).getByText('Use the date format for this document.')).toBeVisible();
    act(() => useDocumentStore.getState().setFormData({ date: '12 Nov 26' }));
    expect(screen.getByLabelText('Proofread: 0 findings')).toBeInTheDocument();
    expect(within(dialog).getByRole('status')).toHaveTextContent('0 findings to review');
    expect(within(dialog).getByText(/No findings from the available checks/)).toBeVisible();
    expect(dialog.textContent).not.toContain('Ready to send');
  });

  it('closes and opens the actual hidden editor field without altering the draft', async () => {
    view(true);
    const before = structuredClone(useDocumentStore.getState().formData);
    fireEvent.change(screen.getByRole('combobox', { name: 'Document section' }), { target: { value: 'body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Proofread: 1 finding' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to Addressing' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Proofread' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Document section' })).toHaveValue('addressing'));
    await waitFor(() => expect(document.getElementById('date')).toHaveFocus());
    expect(useDocumentStore.getState().formData).toEqual(before);
  });

  it('reads the newly selected document rather than retaining findings from another one', () => {
    view();fireEvent.click(screen.getByRole('button', { name: 'Proofread: 1 finding' }));
    act(() => {
      useDocumentsStore.setState({ currentId: 'different-owner', activationEpoch: 2 });
      useDocumentStore.setState({ documentCategory: 'correspondence', docType: 'mfr', formData: { subject: 'A new record', sigLast: 'EXAMPLE' },
        paragraphs: [{ id: 'new-body', text: 'A separate document.', level: 0 }] });
    });
    expect(screen.queryByText('Use the date format for this document.')).not.toBeInTheDocument();
  });

  it('does not show hidden correspondence findings in form mode', () => {
    useDocumentStore.setState({ documentCategory: 'forms', formType: 'navmc_118_11' });
    view();fireEvent.click(screen.getByRole('button', { name: /^Proofread:/ }));
    expect(screen.queryByText('Use the date format for this document.')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Proofread' })).toBeVisible();
  });
});
