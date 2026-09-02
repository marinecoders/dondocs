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

describe('publication checks', () => {
  it('asks an URGENT instruction for a completion date, and says so until it has one', () => {
    useDocumentStore.setState({ formData: { ...useDocumentStore.getState().formData, miUrgency: 'urgent', miCompletionDate: '' } });
    render(<ITypeCoverSection />);
    expect(screen.getByText(/must give a completion date/i)).toBeTruthy();
  });

  it('says nothing for a NORMAL instruction', () => {
    useDocumentStore.setState({ formData: { ...useDocumentStore.getState().formData, miUrgency: 'normal', miCompletionDate: '' } });
    render(<ITypeCoverSection />);
    expect(screen.queryByText(/must give a completion date/i)).toBeNull();
  });

  it('surfaces a lone substep from the paragraphs', () => {
    useDocumentStore.setState({
      formData: { ...useDocumentStore.getState().formData, miUrgency: 'normal' },
      paragraphs: [
        { text: 'Step.', level: 0, procedure: true },
        { text: 'Only substep.', level: 1, procedure: true },
      ],
    });
    render(<ITypeCoverSection />);
    expect(screen.getByText(/needs a sibling/i)).toBeTruthy();
  });
});
