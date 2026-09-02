// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ITypeCoverSection } from '@/components/editor/ITypeCoverSection';
import { useDocumentStore } from '@/stores/documentStore';

beforeEach(() => {
  useDocumentStore.setState({ endItems: [], formData: { ...useDocumentStore.getState().formData, nomenclature: '' } });
});

describe('ITypeCoverSection', () => {
  it('records the nomenclature on the document', () => {
    render(<ITypeCoverSection />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Nomenclature' }), { target: { value: 'COMBAT OPERATIONS CENTER' } });
    expect(useDocumentStore.getState().formData.nomenclature).toBe('COMBAT OPERATIONS CENTER');
  });

  it('adds and edits an end item', () => {
    render(<ITypeCoverSection />);
    fireEvent.click(screen.getByRole('button', { name: /add end item/i }));
    fireEvent.change(screen.getByLabelText(/NSN, end item 1/i), { target: { value: '5895-01-520-4360' } });
    expect(useDocumentStore.getState().endItems[0].nsn).toBe('5895-01-520-4360');
  });

  it('stops offering more once the six printed rows are used', () => {
    useDocumentStore.setState({
      endItems: Array.from({ length: 6 }, () => ({ nsn: '', tamcn: '', id: '', model: '' })),
    });
    render(<ITypeCoverSection />);
    expect(screen.queryByRole('button', { name: /add end item/i })).toBeNull();
  });
});
