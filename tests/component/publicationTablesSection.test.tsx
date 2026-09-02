// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PublicationTablesSection } from '@/components/editor/PublicationTablesSection';
import { useDocumentStore } from '@/stores/documentStore';

const withParagraph = (tableKey: string, header: string) =>
  useDocumentStore.setState({
    paragraphs: [{ text: '', level: 0, header, tableKey }],
    publicationTables: {},
  });

beforeEach(() => useDocumentStore.setState({ paragraphs: [], publicationTables: {} }));

describe('PublicationTablesSection', () => {
  it('shows only the tables the paragraphs carry', () => {
    withParagraph('materielRequired', 'Materiel Required');
    render(<PublicationTablesSection />);
    expect(screen.getByText('Materiel Required')).toBeTruthy();
    expect(screen.queryByText('Special Tools')).toBeNull();
  });

  it('adds a row using the table’s own columns', () => {
    withParagraph('majorItems', 'Major Items Affected');
    render(<PublicationTablesSection />);
    fireEvent.click(screen.getByRole('button', { name: /add row/i }));
    // Major Items has TAMCN; the materiel shape does not.
    fireEvent.change(screen.getByLabelText(/TAMCN, Major Items Affected row 1/i), { target: { value: 'A02557G' } });
    expect(useDocumentStore.getState().publicationTables.majorItems[0].values.tamcn).toBe('A02557G');
  });

  it('nests a consisting-of row and stops at the second level', () => {
    withParagraph('materielRequired', 'Materiel Required');
    render(<PublicationTablesSection />);
    fireEvent.click(screen.getByRole('button', { name: /add row/i }));
    const indent = screen.getByRole('button', { name: /indent row 1/i });
    fireEvent.click(indent);
    fireEvent.click(indent);
    expect(useDocumentStore.getState().publicationTables.materielRequired[0].level).toBe(2);
    expect(indent).toBeDisabled();
  });

  it('offers no nesting on a table that does not nest', () => {
    withParagraph('materielDiscarded', 'Materiel Discarded');
    render(<PublicationTablesSection />);
    fireEvent.click(screen.getByRole('button', { name: /add row/i }));
    expect(screen.queryByRole('button', { name: /indent row/i })).toBeNull();
  });
});
