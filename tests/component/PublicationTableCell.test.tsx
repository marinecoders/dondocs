import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublicationTableCell } from '@/components/editor/PublicationTableCell';

it.each(['', 'ABCDEF0123456789ABCDEF0123456789'])('adds a footnote only with a current target identity: %s', async identity => {
  const onChange = vi.fn();
  render(<PublicationTableCell value="BOLT" label="Description" paragraph={{ level: 0, text: '', tableFootnotes: [{ id: '1', text: 'One per assembly.' }] }} onChange={onChange} ensureReferenceId={() => identity} />);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Add footnote to Description' }), '1');
  if (identity) expect(onChange).toHaveBeenCalledWith('BOLT{{PUBREF_N_ABCDEF0123456789ABCDEF0123456789_1}}');
  else expect(onChange).not.toHaveBeenCalled();
});
