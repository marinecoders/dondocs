import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CorrespondencePicker } from '@/components/editor/CorrespondencePicker';
import { DOC_TYPE_CONFIG } from '@/types/document';

it.each(['MFR', 'MOA', 'MOU', 'I-Type'])('searches the %s abbreviation without changing the document', async query => {
  const onSelect = vi.fn();
  render(<CorrespondencePicker value="naval_letter" onSelect={onSelect} />);
  await userEvent.click(screen.getByRole('button', { name: 'Correspondence type' }));
  const search = screen.getByRole('combobox', { name: 'Search correspondence' });
  expect(search).toHaveFocus();
  await userEvent.type(search, query);
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(onSelect).not.toHaveBeenCalled();
});

it('selects a filtered result with the keyboard and returns focus to the trigger', async () => {
  const onSelect = vi.fn();
  render(<CorrespondencePicker value="naval_letter" onSelect={onSelect} />);
  const trigger = screen.getByRole('button', { name: 'Correspondence type' });
  await userEvent.click(trigger);
  const search = screen.getByRole('combobox', { name: 'Search correspondence' });
  await userEvent.type(search, 'business');
  await userEvent.keyboard('{ArrowDown}');
  expect(search).toHaveAttribute('aria-activedescendant', screen.getByRole('option').id);
  await userEvent.keyboard('{Enter}');
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('business_letter');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('handles no matches, Escape, and a fresh search on reopening', async () => {
  const onSelect = vi.fn();
  render(<CorrespondencePicker value="naval_letter" onSelect={onSelect} />);
  const trigger = screen.getByRole('button', { name: 'Correspondence type' });
  await userEvent.click(trigger);
  await userEvent.type(screen.getByRole('combobox'), 'no-such-format');
  expect(screen.getByRole('status')).toHaveTextContent('No correspondence types match');
  await userEvent.keyboard('{ArrowDown}{Enter}{Escape}');
  expect(onSelect).not.toHaveBeenCalled();
  await waitFor(() => expect(trigger).toHaveFocus());
  await userEvent.click(trigger);
  expect(screen.getByRole('combobox')).toHaveValue('');
  expect(screen.getAllByRole('option')).toHaveLength(Object.keys(DOC_TYPE_CONFIG).length);
});

it('searches by group while retaining group labels and the selected format', async () => {
  render(<CorrespondencePicker value="new_page_endorsement" onSelect={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Correspondence type' }));
  await userEvent.type(screen.getByRole('combobox'), 'endorsements');
  expect(screen.getByRole('group', { name: 'Endorsements' })).toBeVisible();
  expect(screen.getAllByRole('option')).toHaveLength(2);
  expect(screen.getByRole('option', { name: 'New-Page Endorsement' })).toHaveAttribute('aria-selected', 'true');
});
