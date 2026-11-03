import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentTypeSelector } from '@/components/editor/DocumentTypeSelector';
import { useDocumentStore } from '@/stores/documentStore';

beforeEach(() => useDocumentStore.setState({
  documentCategory: 'correspondence', docType: 'naval_letter',
  documentMode: 'compliant', formData: { pageNumbering: 'none' },
}));

describe('page numbering controls', () => {
  it('shows automatic SECNAV numbering even for an older saved draft with none selected', () => {
    render(<DocumentTypeSelector />);
    expect(screen.getByRole('combobox', { name: 'Page numbering' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Page numbering' })).toHaveTextContent('Page number');
  });

  it('allows a custom document to select bottom page numbers', async () => {
    useDocumentStore.setState({ documentMode: 'custom' });
    const user = userEvent.setup();
    render(<DocumentTypeSelector />);
    await user.click(screen.getByRole('combobox', { name: 'Page numbering' }));
    await user.click(screen.getByRole('option', { name: /^Page number$/ }));
    expect(useDocumentStore.getState().formData.pageNumbering).toBe('simple');
  });
});
