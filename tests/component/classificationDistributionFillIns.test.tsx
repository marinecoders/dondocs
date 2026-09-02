// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassificationSection } from '@/components/editor/ClassificationSection';
import { useDocumentStore } from '@/stores/documentStore';

// Domain restriction and the async config are mocked to a settled, permissive
// state, as ClassificationSection.test.tsx does: otherwise the test host's
// hostname disallows CUI and the section resets the level before the CUI
// block can render.
const ALL_LEVELS = ['unclassified', 'cui', 'confidential', 'secret', 'top_secret', 'top_secret_sci'];
vi.mock('@/lib/domainClassification', () => ({
  getDomainClassificationRestriction: () => ({ allowedLevels: ALL_LEVELS }),
  getDomainRestrictionMessage: () => 'All levels permitted (test).',
}));
vi.mock('@/config/classification', () => ({
  getClassificationConfig: () => Promise.resolve(null),
}));

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

  // The section is an accordion; its fields exist once it is expanded.
  const expand = async () => {
    fireEvent.click(screen.getByText('Classification'));
    await screen.findByText('CUI Configuration');
  };

  it('asks a publication with Statement D for a reason and a date', async () => {
    useDocumentStore.getState().setDocType('i_type');
    cuiWith('D');
    render(<ClassificationSection />);
    await expand();
    expect(await screen.findByRole('combobox', { name: 'Reason for restriction' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Date of determination'), { target: { value: '2024-12-01' } });
    expect(useDocumentStore.getState().formData.distDate).toBe('2024-12-01');
    expect(screen.getByText(/Distribution Statement D still needs/)).toBeTruthy();
  });

  it('asks F for the date only', async () => {
    useDocumentStore.getState().setDocType('i_type');
    cuiWith('F');
    render(<ClassificationSection />);
    await expand();
    expect(await screen.findByLabelText('Date of determination')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Reason for restriction' })).toBeNull();
  });

  it('asks a letter nothing', async () => {
    useDocumentStore.getState().setDocType('naval_letter');
    cuiWith('D');
    render(<ClassificationSection />);
    await expand();
    expect(screen.queryByLabelText('Date of determination')).toBeNull();
  });
});
