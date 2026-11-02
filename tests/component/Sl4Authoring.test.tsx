import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { useDocumentStore } from '@/stores/documentStore';
import { useDocumentsStore } from '@/stores/documentsStore';
import { useAlertStore } from '@/stores/alertStore';
import { sl4Fixture } from '../_helpers/sl4Fixture';
import { Sl4PartsSection, Sl4PrefaceSection, Sl4CagesSection, Sl4IndexesSection, Sl4RevisionsSection, Sl4CoverSection, Sl4IllustrationsSection } from '@/components/editor/Sl4Sections';
afterEach(cleanup);
beforeEach(() => {
  useDocumentStore.getState().resetForm(); useDocumentStore.setState(sl4Fixture());
  useDocumentsStore.setState({ currentId: 'sl4-a' });
  useAlertStore.setState({ open: false, current: null, queue: [] });
});

describe('SL-4 authoring controls', () => {
  it('jumps directly to the chosen repair part and focuses its name', async () => {
    const user = userEvent.setup();
    render(<Sl4PartsSection />);
    await user.selectOptions(screen.getByLabelText('Jump to repair part'), 'screw');
    await waitFor(() => expect(screen.getByLabelText('Item 3 nomenclature')).toHaveFocus());
  });
  it('shows the export validation beside an invalid quantity and clears it after correction', () => {
    render(<Sl4PartsSection />);
    const quantity = screen.getByLabelText('Item 3 Quantity per application');
    fireEvent.change(quantity, { target: { value: '0' } });
    expect(quantity).toHaveAttribute('aria-invalid', 'true');
    expect(quantity).toHaveAccessibleDescription('Enter a positive quantity per application.');
    fireEvent.change(quantity, { target: { value: '4' } });
    expect(quantity).not.toHaveAttribute('aria-invalid');
    expect(useDocumentStore.getState().formData.sl4!.rows.find(row => row.id === 'screw')).toHaveProperty('quantityPerEquipment', '4');
  });
  it('previews the completed preface using the same metadata and subparagraph numbers as the PDF', () => {
    render(<Sl4PrefaceSection />);
    fireEvent.click(screen.getByText('Publication preface', { exact: true }));
    expect(screen.getByText(/Information in this Repair Parts List/)).toHaveTextContent('30 October 2026');
    expect(screen.getByText(/RPL, SL-4-12345A/)).toBeInTheDocument();
    expect(screen.queryByText(/DD Month YYYY|SL-4-xxxxxX|12a\./)).not.toBeInTheDocument();
  });
  it('shows the complete index fields and omits inapplicable circuit-table columns', () => {
    render(<Sl4IndexesSection />);
    const stock = within(screen.getByRole('region', { name: 'Part III — National stock numbers' }));
    expect(stock.getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Item', 'Stock number', 'CAGE', 'Part number']);
    const circuits = within(screen.getByRole('region', { name: 'Part V — Circuit symbols' }));
    expect(circuits.getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Item', 'Circuit symbol']);
  });
  it('removes a confirmed component group and invalidates illustration review', async () => {
    render(<Sl4PartsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Item 1' }));
    await act(async () => { useAlertStore.getState().dismiss(true); });
    const data = useDocumentStore.getState().formData.sl4!;
    for (const id of ['kit', 'board', 'screw']) expect(data.rows.map(row => row.id)).not.toContain(id);
    expect(data.artwork).toEqual([]);
  });
  it('cannot apply a pending deletion to another document', async () => {
    render(<Sl4PartsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Item 1' }));
    const other = sl4Fixture();
    await act(async () => {
      useDocumentsStore.setState({ currentId: 'sl4-b' });
      useDocumentStore.setState(other);
      useAlertStore.getState().dismiss(true);
    });
    expect(useDocumentStore.getState().formData.sl4).toEqual(other.formData.sl4);
  });
  it('preserves edits made while a deletion confirmation is pending', async () => {
    render(<Sl4PartsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Item 1' }));
    const changed = structuredClone(useDocumentStore.getState().formData.sl4!);
    changed.notes[0].text = 'Updated while confirmation was open.';
    await act(async () => {
      useDocumentStore.getState().setField('sl4', changed);
      useAlertStore.getState().dismiss(true);
    });
    expect(useDocumentStore.getState().formData.sl4).toEqual(changed);
    expect(screen.getByRole('alert')).toHaveTextContent('draft changed');
  });
  it('edits separate quantities, replacement flags and stable same-as references', () => {
    render(<Sl4PartsSection />);
    fireEvent.change(screen.getByLabelText('Item 3 Quantity per application'), { target: { value: '4' } });
    fireEvent.click(screen.getByLabelText('Item 3 ECO economic replacement'));
    const rows = useDocumentStore.getState().formData.sl4!.rows;
    expect(rows.find((row) => row.id === 'screw')).toMatchObject({ quantityPerApplication: '4', quantityPerEquipment: '4', economicReplacement: true });
    expect(rows.at(-1)).toHaveProperty('relationship.itemIds', ['resistor']);
    fireEvent.click(screen.getByRole('button', { name: 'Add repair part' }));
    expect(useDocumentStore.getState().formData.sl4!.rows.at(-1)).toHaveProperty('kind', 'part');
  });
  it('preserves incomplete relationship selection without losing the draft', () => {
    render(<Sl4PartsSection />);
    fireEvent.change(screen.getByLabelText('Item 2 related-item type'), { target: { value: 'assembled_from' } });
    expect(useDocumentStore.getState().formData.sl4!.rows[2]).toHaveProperty('relationship.itemIds', []);
    fireEvent.change(screen.getByLabelText('Item 2 related items'), { target: { value: 'screw' } });
    expect(useDocumentStore.getState().formData.sl4!.rows[2]).toHaveProperty('relationship.itemIds', ['screw']);
  });
  it('exposes cover fields with SL-4 identity and no SL-3 inventory-layout choices', () => {
    render(<Sl4CoverSection />);
    expect(screen.getByLabelText('Short title')).toHaveValue('SL-4-12345A');
    expect(screen.queryByLabelText('Inventory layout')).not.toBeInTheDocument();
  });
  it('retains separate lines when editing the command mailing address', () => {
    render(<Sl4CoverSection />);
    const address = screen.getByLabelText('Command address');
    expect(address.tagName).toBe('TEXTAREA');
    fireEvent.change(address, { target: { value: '100 EXAMPLE WAY\nEXAMPLE CITY VA 00000' } });
    expect(useDocumentStore.getState().formData.unitAddress).toBe('100 EXAMPLE WAY\nEXAMPLE CITY VA 00000');
  });
  it('keeps SL-3 inventory grids out of the SL-4 illustration editor', () => {
    render(<Sl4IllustrationsSection />);
    expect(screen.getByLabelText('End item illustration')).toBeInTheDocument();
    expect(screen.queryByLabelText('Item illustrations per page')).not.toBeInTheDocument();
    expect(screen.queryByText(/Each grid follows its inventory sheet/)).not.toBeInTheDocument();
  });
  it('chooses the cut-off date without changing the publication date', async () => {
    const user = userEvent.setup();
    const store = useDocumentStore.getState();
    const publicationDate = store.formData.date;
    store.setField('sl4', { ...store.formData.sl4!, cutoffDate: '2026-10-28' });
    render(<Sl4PrefaceSection />);
    expect(screen.getByLabelText('Publication cut-off date')).toHaveValue('2026-10-28');
    await user.click(screen.getByRole('button', { name: 'Choose publication cut-off date' }));
    await user.click(screen.getByRole('button', { name: /Thursday, October 29th, 2026/ }));
    expect(useDocumentStore.getState().formData.sl4!.cutoffDate).toBe('2026-10-29');
    expect(useDocumentStore.getState().formData.date).toBe(publicationDate);
  });
  it('retains invalid revision dates for validation without rolling them forward', () => {
    render(<Sl4RevisionsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Add revision record' }));
    const input = screen.getByLabelText('Revision 1 date');
    fireEvent.change(input, { target: { value: '2026-02-30' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('2026-02-30');
    expect(useDocumentStore.getState().formData.sl4!.revisions[0].date).toBe('2026-02-30');
    expect(screen.getByRole('button', { name: 'Choose revision 1 date' })).toBeInTheDocument();
  });
  it('edits preface, CAGE, index and revision sections', () => {
    const first = render(<Sl4PrefaceSection />);
    fireEvent.change(screen.getByLabelText('Source maintenance manual'), { target: { value: 'Training manual' } });
    expect(useDocumentStore.getState().formData.sl4!.sourceManual).toBe('Training manual');
    first.unmount();
    const cages = render(<Sl4CagesSection />);
    fireEvent.change(screen.getByLabelText('Entity 1 name'), { target: { value: 'Training maker' } });
    expect(useDocumentStore.getState().formData.sl4!.cages[0].name).toBe('Training maker');
    cages.unmount();
    const indexes = render(<Sl4IndexesSection />);
    fireEvent.change(screen.getByLabelText('Circuit-symbol index'), { target: { value: 'omitted_excessive' } });
    fireEvent.change(screen.getByLabelText('Circuit-index omission reason'), { target: { value: 'Training index is excessive.' } });
    expect(useDocumentStore.getState().formData.sl4!.circuitIndex.reason).toContain('excessive');
    indexes.unmount();
    render(<Sl4RevisionsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Add revision record' }));
    fireEvent.change(screen.getByLabelText('Revision 1 number'), { target: { value: 'A' } });
    expect(useDocumentStore.getState().formData.sl4!.revisions[0].revision).toBe('A');
  });
});
