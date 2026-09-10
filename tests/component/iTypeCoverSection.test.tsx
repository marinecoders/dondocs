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

  it('names an appendix that has no title', () => {
    useDocumentStore.setState({
      formData: { ...useDocumentStore.getState().formData, miUrgency: 'normal' },
      paragraphs: [
        { text: 'Body.', level: 0 },
        { text: '', level: 0, header: 'Torque Values', appendix: true },
        { text: '', level: 0, appendix: true },
      ],
    });
    render(<ITypeCoverSection />);
    expect(screen.getByText(/Appendix B has no title/)).toBeTruthy();
    expect(screen.queryByText(/Appendix A has no title/)).toBeNull();
  });
});

// The I-Type's rail carries no addressing or letterhead section — the letter's
// homes for the long title, the date, and the issuing command. All three print
// on the cover or the authentication page, so the Cover section carries them
// itself; without these they exist in the store with no way to fill them in.
describe('what the cover prints but the letter sections used to own', () => {
  it('types the long title into the store', () => {
    render(<ITypeCoverSection />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Long title' }), {
      target: { value: 'INSTALLATION OF THE STOCK ACCESSORY RAIL' },
    });
    expect(useDocumentStore.getState().formData.subject).toBe('INSTALLATION OF THE STOCK ACCESSORY RAIL');
  });

  it('offers a date field — the cover date and the page headers derive from it', () => {
    render(<ITypeCoverSection />);
    expect(screen.getByLabelText(/^date$/i)).toBeTruthy();
  });

  it('types the issuing command lines that head the authentication page', () => {
    render(<ITypeCoverSection />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Issuing command' }), {
      target: { value: 'MARINE CORPS SYSTEMS COMMAND' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Issuing command address' }), {
      target: { value: '2200 LESTER STREET, QUANTICO, VA 22134' },
    });
    const { unitLine1, unitAddress } = useDocumentStore.getState().formData;
    expect(unitLine1).toBe('MARINE CORPS SYSTEMS COMMAND');
    expect(unitAddress).toBe('2200 LESTER STREET, QUANTICO, VA 22134');
  });

  it('offers the four publication types, defaulting to a modification', () => {
    render(<ITypeCoverSection />);
    expect(screen.getByRole('combobox', { name: 'Publication type' }).textContent).toMatch(/Modification Instruction/);
  });

  it('types the controlling office into the store', () => {
    render(<ITypeCoverSection />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Controlling office' }), { target: { value: 'PM IW' } });
    expect(useDocumentStore.getState().formData.controllingOffice).toBe('PM IW');
  });
});
