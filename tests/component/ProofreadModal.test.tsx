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
import * as domainClassification from '@/lib/domainClassification';

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

  it('focuses the actual paragraph heading and table cell for sensitive-text findings', async () => {
    useDocumentStore.setState({ formData: { date: '12 Nov 26', subject: 'Synthetic rich review' }, paragraphs: [
      { id: 'heading-owner', text: 'Ordinary body text.', header: 'Synthetic 123-45-6789', level: 0 },
      { id: 'table-owner', text: '', level: 0, bodyTable: { headerRows: 1, rows: [['One', 'Two'], ['Ordinary', 'Synthetic 321-54-9876']] } },
    ] });
    view(true);
    for (const [title, name] of [['Social Security Number pattern in Paragraph 1 heading', 'Heading for paragraph 1'],
      ['Social Security Number pattern in Paragraph 2', 'Table 2, row 2, column 2']]) {
      fireEvent.click(screen.getByRole('button', { name: /^Proofread:/ }));
      const row = screen.getByText(title, { exact: true }).closest('li')!;
      fireEvent.click(within(row).getByRole('button', { name: 'Go to Paragraphs' }));
      await waitFor(() => expect(screen.getByRole('textbox', { name })).toHaveFocus());
    }
  });

  it('hides inactive classification findings and opens a printed legacy signer at the memo control', async () => {
    useDocumentStore.setState({ docType: 'joint_memorandum', formData: { date: '12 Nov 26', subject: 'Synthetic joint review',
      classLevel: 'unclassified', cuiControlledBy: 'hidden.cui@example.test', classifiedBy: 'hidden.authority@example.test',
      jointSeniorSigName: 'legacy@example.test', jointMemoJuniorSigName: 'JUNIOR' } });
    view(true);
    fireEvent.click(screen.getByRole('button', { name: /^Proofread:/ }));
    expect(screen.queryByText(/pattern in Form: (?:cuiControlledBy|classifiedBy)/)).not.toBeInTheDocument();
    const row = screen.getByText('Personal Email Address pattern in Form: jointSeniorSigName', { exact: true }).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Go to Commands' }));
    await waitFor(() => expect(document.getElementById('jointMemoSeniorSigName')).toHaveFocus());
    expect(document.getElementById('jointMemoSeniorSigName')).toHaveValue('legacy@example.test');
  });

  it('opens a figure alternative and table footnote without selecting their paragraph text', async () => {
    useDocumentStore.setState({ docType: 'i_type', paragraphs: [
      { id: 'alternative-owner', text: 'Ordinary caption', level: 0, figure: { altText: 'Synthetic 123-45-6789' } },
      { id: 'footnote-owner', text: 'Ordinary table text', level: 0, tableKey: 'majorItems', tableFootnotes: [{ id: '1', text: 'Synthetic 321-54-9876' }] },
    ] });
    view(true);
    for (const [title, name] of [['Social Security Number pattern in Paragraph 1', 'Alternative text for image 1'],
      ['Social Security Number pattern in Paragraph 2 footnote 1', 'Table footnote 1']]) {
      fireEvent.click(screen.getByRole('button', { name: /^Proofread:/ }));
      const row = screen.getByText(title, { exact: true }).closest('li')!;
      fireEvent.click(within(row).getByRole('button', { name: 'Go to Paragraphs' }));
      await waitFor(() => expect(screen.getByRole('textbox', { name })).toHaveFocus());
    }
  });

  it.each(['sl3', 'sl4'])('opens the separate %s illustration caption input', async docType => {
    useDocumentStore.setState({ docType, paragraphs: [{ id: 'stock-caption', referenceId: 'stock-figure', text: 'Synthetic 123-45-6789', level: 0, figure: {} }] });
    view(true);
    fireEvent.click(screen.getByRole('button', { name: /^Proofread:/ }));
    const row = screen.getByText('Social Security Number pattern in Paragraph 1', { exact: true }).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Go to Illustrations' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Illustration 1 (unassigned) title' })).toHaveFocus());
  });

  it('opens the actual selector for a sensitive composed CUI distribution statement', async () => {
    const restriction = vi.spyOn(domainClassification, 'getDomainClassificationRestriction')
      .mockReturnValue({ maxLevel: 'cui', allowedLevels: ['unclassified', 'cui'] });
    try {
      useDocumentStore.setState({ formData: { date: '12 Nov 26', classLevel: 'cui', cuiDistStatement: 'B', distDate: '2026-11-19',
        distReason: 'Synthetic reason 123-45-6789', controllingOffice: 'Training Office' } });
      view(true);
      fireEvent.click(screen.getByRole('button', { name: /^Proofread:/ }));
      const row = screen.getByText('Social Security Number pattern in Distribution statement', { exact: true }).closest('li')!;
      fireEvent.click(within(row).getByRole('button', { name: 'Go to Classification' }));
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Distribution Statement' })).toHaveFocus());
      expect(document.getElementById('distReason')).toBeNull();
      expect(document.getElementById('controllingOffice')).toBeNull();
    } finally { restriction.mockRestore(); }
  });
  it('opens an executive memorandum formatting finding at the actual date input', async () => {
    useDocumentStore.setState({ docType: 'standard_memorandum' });
    view(true);
    fireEvent.click(screen.getByRole('button', { name: /^Proofread:/ }));
    const row = screen.getAllByRole('listitem').find(item => item.textContent?.includes('Use the date format for this document.'));
    expect(row).toBeDefined();
    fireEvent.click(within(row!).getByRole('button', { name: 'Go to Heading' }));
    await waitFor(() => expect(document.getElementById('date')).toHaveFocus());
  });

});
