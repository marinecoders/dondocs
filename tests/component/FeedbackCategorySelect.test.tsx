import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FeedbackCategorySelect } from '@/components/FeedbackCategorySelect';

it('shows legacy absence without offering it as a mutation and emits only categories', () => {
  const change = vi.fn();
  render(<FeedbackCategorySelect label="Category" value="unclassified" onChange={change} />);
  const select = screen.getByRole('combobox', { name: 'Category' });
  expect(screen.getByRole('option', { name: 'Unclassified' })).toBeDisabled();
  fireEvent.change(select, { target: { value: 'question' } });
  expect(change).toHaveBeenCalledWith('question');
  change.mockClear();
  fireEvent.change(select, { target: { value: 'all' } });
  expect(change).not.toHaveBeenCalled();
});

it('permits missing-category selection only for filters', () => {
  const change = vi.fn();
  render(<FeedbackCategorySelect label="Filter" value="all" filter onChange={change} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'unclassified' } });
  expect(change).toHaveBeenCalledWith('unclassified');
});
