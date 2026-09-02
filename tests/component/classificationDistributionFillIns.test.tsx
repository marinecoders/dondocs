// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassificationSection } from '@/components/editor/ClassificationSection';
import { useDocumentStore } from '@/stores/documentStore';

// On a technical publication the Distribution Statement prints in full, so
// B through F ask for the fill-ins the template leaves to the author. A
// letter stores the letter alone and is asked nothing more.

const cuiWith = (letter: string) => {
  const s = useDocumentStore.getState();
  s.setField('classLevel', 'cui');
  s.setField('cuiDistStatement', letter);
};

describe('ClassificationSection distribution fill-ins', () => {
  beforeEach(() => {
    useDocumentStore.getState().resetForm();
  });

  it('asks a publication with Statement D for a reason and a date', () => {
    useDocumentStore.getState().setDocType('i_type');
    cuiWith('D');
    render(<ClassificationSection />);
    expect(screen.getByRole('combobox', { name: 'Reason for restriction' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Date of determination'), { target: { value: '2024-12-01' } });
    expect(useDocumentStore.getState().formData.distDate).toBe('2024-12-01');
    expect(screen.getByText(/Distribution Statement D still needs/)).toBeTruthy();
  });

  it('asks F for the date only', () => {
    useDocumentStore.getState().setDocType('i_type');
    cuiWith('F');
    render(<ClassificationSection />);
    expect(screen.queryByRole('combobox', { name: 'Reason for restriction' })).toBeNull();
    expect(screen.getByLabelText('Date of determination')).toBeTruthy();
  });

  it('asks a letter nothing', () => {
    useDocumentStore.getState().setDocType('naval_letter');
    cuiWith('D');
    render(<ClassificationSection />);
    expect(screen.queryByLabelText('Date of determination')).toBeNull();
  });
});
