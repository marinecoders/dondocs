import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PackageDocumentPicker } from '@/components/PackageDocumentPicker';

vi.mock('@/services/formCatalog', () => ({
  useFormCatalog: () => Array.from({ length: 2000 }, (_, i) => ({
    formType: 'training_' + i, title: 'Training worksheet ' + i, number: 'TR ' + i,
    name: 'Training worksheet ' + i, keywords: [],
  })),
}));
vi.mock('@/services/formRegistry', () => ({ useFormCatalogStatus: () => ({ status: 'ready' }) }));

it('browses a large catalog in pages and can add the last form directly by number', () => {
  const add = vi.fn();
  render(<PackageDocumentPicker docs={{}} currentId={null} onLibrary={vi.fn()} onForm={add}
    onCorrespondence={vi.fn()} upload={null} />);
  fireEvent.click(screen.getByRole('button', { name: 'Forms' }));
  const forms = within(screen.getByRole('region', { name: 'Forms' }));
  const visible = () => forms.getAllByRole('button', { name: /^Add / }).length;
  const first = visible();
  expect(first).toBeLessThan(2000);
  fireEvent.click(forms.getByRole('button', { name: 'Show more forms' }));
  expect(visible()).toBeGreaterThan(first);
  const input = screen.getByRole('searchbox', { name: 'Search documents to add' });
  fireEvent.change(input, { target: { value: 'TR-1999' } });
  fireEvent.click(forms.getByRole('button', { name: 'Add Training worksheet 1999' }));
  expect(add).toHaveBeenCalledWith('training_1999', 'Training worksheet 1999');
  fireEvent.change(input, { target: { value: '' } });
  expect(visible()).toBe(first);
});
