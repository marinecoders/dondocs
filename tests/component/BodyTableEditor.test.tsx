import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BodyTableEditor } from '@/components/editor/BodyTableEditor';
import { bodyTableSchema, type BodyTable } from '@/lib/bodyTable';
function Harness() {
  const [table, setTable] = useState<BodyTable>({ rows: [['Name', 'Description'], ['ALPHA', 'A longer readable description']], headerRows: 1 });
  return <><BodyTableEditor table={table} index={0} onChange={setTable} /><output data-testid="table-model">{JSON.stringify(table)}</output></>;
}
const model = () => bodyTableSchema.parse(JSON.parse(screen.getByTestId('table-model').textContent!));
describe('native table formatting controls', () => {
  it('preserves formatting when cells and rows change, and resizes the column model coherently', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Lines for table 1'), { target: { value: 'outline' } });
    fireEvent.change(screen.getByLabelText('Text size for table 1'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Resize table 1 column 1'), { target: { value: '25' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Table 1, row 2, column 1' }), { target: { value: 'BRAVO' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add table row' }));
    expect(model()).toMatchObject({ borders: 'outline', fontSize: 10, columnWidths: [25, 75], rows: [['Name', 'Description'], ['BRAVO', 'A longer readable description'], ['', '']] });
    fireEvent.click(screen.getByRole('button', { name: 'Add table column' }));
    expect(model().columnWidths).toHaveLength(3);
    expect(model().columnWidths!.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100);
    fireEvent.click(screen.getByRole('button', { name: 'Remove last column' }));
    expect(model().borders).toBe('outline');
    expect(model().rows[1]).toEqual(['BRAVO', 'A longer readable description']);
  });
  it('lets a person type a complete width before committing it and lets Escape restore it', () => {
    render(<Harness />);
    const width = screen.getByLabelText('Width percentage for table 1 column 1');
    fireEvent.focus(width);fireEvent.change(width, { target: { value: '' } });fireEvent.change(width, { target: { value: '2' } });
    expect(model().columnWidths).toBeUndefined();
    fireEvent.change(width, { target: { value: '25' } });fireEvent.blur(width);
    expect(model().columnWidths).toEqual([25, 75]);
    fireEvent.focus(width);fireEvent.change(width, { target: { value: '70' } });fireEvent.keyDown(width, { key: 'Escape' });
    expect(model().columnWidths).toEqual([25, 75]);
  });
  it('keeps header repetition and fit-to-text deliberate', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Repeat headers on later pages'));
    expect(model().repeatHeaders).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Fit widths to text' }));
    expect(model().columnWidths![1]).toBeGreaterThan(model().columnWidths![0]);
    fireEvent.click(screen.getByRole('button', { name: 'Equal widths' }));
    expect(model().columnWidths).toBeUndefined();
    expect(model().repeatHeaders).toBe(false);
  });
});
