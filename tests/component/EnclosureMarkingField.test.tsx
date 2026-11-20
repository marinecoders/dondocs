import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EnclosureMarkingField } from '@/components/editor/EnclosureMarkingField';

vi.mock('@/config/classification', () => ({ getClassificationConfig: async () => null, getClassificationConfigSync: () => null }));

it('offers a deliberate inherit choice distinct from an unclassified assembled banner', async () => {
  const user = userEvent.setup(), changed = vi.fn();
  const { rerender } = render(<EnclosureMarkingField index={0} onChange={changed} />);
  const select = screen.getByRole('combobox', { name: 'Enclosure (1) marking' });
  expect(select).toHaveTextContent('Inherit the letter marking');
  await user.click(select);
  await user.click(screen.getByRole('option', { name: 'UNCLASSIFIED' }));
  expect(changed).toHaveBeenLastCalledWith({ classLevel: 'unclassified' });
  rerender(<EnclosureMarkingField index={0} marking={{ classLevel: 'unclassified' }} onChange={changed} />);
  await user.click(select);
  await user.click(screen.getByRole('option', { name: 'Inherit the letter marking' }));
  expect(changed).toHaveBeenLastCalledWith(undefined);
});

it('retains exact custom text through the existing update callback', async () => {
  const user = userEvent.setup(), changed = vi.fn();
  render(<EnclosureMarkingField index={1} marking={{ classLevel: 'custom', customClassification: 'CUI' }} onChange={changed} />);
  await user.type(screen.getByLabelText('Exact banner text'), 'X');
  expect(changed).toHaveBeenLastCalledWith({ classLevel: 'custom', customClassification: 'CUIX' });
  expect(screen.getByText(/original PDF and its existing markings stay unchanged/)).toBeInTheDocument();
});
