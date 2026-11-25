import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PackageOfficialFormChoices } from '@/components/PackageOfficialFormChoices';

it('finds a form near the end of a large catalog without rendering all the buttons', () => {
  const forms = Array.from({ length: 2000 }, (_, n) => ({ id: 'navmc_' + n, label: 'Training worksheet ' + n }));
  const add = vi.fn();
  render(<PackageOfficialFormChoices forms={forms} onAdd={add} />);
  expect(screen.getAllByRole('button')).toHaveLength(12);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'NAVMC 1999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Training worksheet 1999' }));
  expect(add).toHaveBeenCalledWith('navmc_1999');
});
