// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
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

  it('adds and edits a seventh end item for the cover continuation', () => {
    useDocumentStore.setState({
      endItems: Array.from({ length: 6 }, () => ({ nsn: '', tamcn: '', id: '', model: '' })),
    });
    render(<ITypeCoverSection />);
    fireEvent.click(screen.getByRole('button', { name: /add end item/i }));
    fireEvent.change(screen.getByLabelText('MODEL, end item 7'), { target: { value: 'RADIO' } });
    expect(useDocumentStore.getState().endItems).toHaveLength(7);
    expect(useDocumentStore.getState().endItems[6].model).toBe('RADIO');
    expect(screen.getByText(/list will print on a continuation page/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /add end item/i }));
    expect(useDocumentStore.getState().endItems).toHaveLength(8);
  });
});

describe('publication checks', () => {
  it('keeps both reported warnings visible until the supplied required text is used', () => {
    const original = useDocumentStore.getState();
    try {
      useDocumentStore.setState({
        formData: { ...original.formData, publicationType: 'TI' },
        paragraphs: [
          { level: 0, header: 'Purpose', text: 'Inspect the equipment.' },
          { level: 0, header: 'Administrative Instructions', text: 'For concerns/issues with the content/procedures contact Equipment Specialist or designated Program Office representative John Doe, jdoe@usmc.mil, 123-456-7890. (Paragraph may be removed if not needed.)' },
        ],
      });
      render(<ITypeCoverSection />);
      expect(screen.getByText(/^Include the prescribed NAVMC 10772 notice/)).toBeTruthy();
      expect(screen.getByText(/^Use the prescribed point-of-contact sentence/)).toBeTruthy();
      const help = screen.getByText('Required Administrative Instructions text').closest('details')!;
      const contact = within(help).getByText(/^For questions or concerns/).textContent!.replace('[PHONE OR SECTION MAILBOX EMAIL]', 'jdoe@usmc.mil');
      const notice = within(help).getByText(/^Discrepancies or suggested changes/).textContent!;
      act(() => useDocumentStore.getState().updateParagraph(1, { text: `${contact} ${notice}` }));
      expect(screen.queryByText(/^Include the prescribed NAVMC 10772 notice/)).toBeNull();
      expect(screen.queryByText(/^Use the prescribed point-of-contact sentence/)).toBeNull();
    } finally { useDocumentStore.setState(original); }
  });

  it('shows the required text for the selected subtype without changing the document', () => {
    const original = useDocumentStore.getState();
    try {
      useDocumentStore.setState({ formData: { ...original.formData, publicationType: 'MI' } });
      render(<ITypeCoverSection />);
      const help = screen.getByText('Required Administrative Instructions text').closest('details')!;
      expect(within(help).getByText(/MIL-DTL-28999D §3.3.2.2 requires this section for all four instruction types/)).toBeTruthy();
      expect(within(help).getByText(/^Operating Forces/)).toBeTruthy();
      for (const [code, name] of [['TI', 'Technical'], ['SI', 'Supply'], ['LI', 'Lubrication']] as const) {
        act(() => useDocumentStore.getState().setField('publicationType', code));
        expect(within(help).getByText(`For questions or concerns with the content or procedures in this ${name} Instruction (${code}) contact [PHONE OR SECTION MAILBOX EMAIL].`)).toBeTruthy();
        expect(within(help).getByText(/^Discrepancies or suggested changes/)).toBeTruthy();
        expect(within(help).queryByText(/^Operating Forces/)).toBeNull();
      }
      expect(useDocumentStore.getState().paragraphs).toEqual(original.paragraphs);
    } finally { useDocumentStore.setState(original); }
  });

  it('guides a prose-only item section through attachment and row entry', () => {
    const original = useDocumentStore.getState();
    const text = 'The support bracket is affected.';
    try {
      useDocumentStore.setState({ docType: 'i_type', paragraphs: [{ level: 0, header: 'Major Items Affected', text }], publicationTables: {} });
      render(<ITypeCoverSection />);
      expect(screen.getByText(/Paragraph 1 \(Major Items Affected\): attach/)).toBeTruthy();
      act(() => {
        useDocumentStore.getState().updateParagraph(0, { tableKey: 'majorItems' });
        useDocumentStore.getState().addTableRow('majorItems');
      });
      expect(screen.getByText(/Paragraph 1 \(Major Items Affected\): add at least one item row/)).toBeTruthy();
      act(() => useDocumentStore.getState().updateTableRow('majorItems', 0, { description: 'SUPPORT BRACKET', nsn: '1005-01-566-1100', tamcn: 'A02557G', id: '12345A' }));
      expect(screen.queryByText(/Paragraph 1 \(Major Items Affected\):/)).toBeNull();
      expect(useDocumentStore.getState().paragraphs[0].text).toBe(text);
    } finally { useDocumentStore.setState(original); }
  });

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
    expect(screen.getByLabelText(/^effective date$/i)).toBeTruthy();
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
