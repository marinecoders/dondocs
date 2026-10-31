import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sl3DateFields } from '@/components/editor/Sl3DateFields';
import { Sl3InventorySection } from '@/components/editor/Sl3Sections';
import { useDocumentStore } from '@/stores/documentStore';
import { sl3Fixture } from '../_helpers/sl3Fixture';

beforeEach(() => {
  useDocumentStore.getState().resetForm();
  useDocumentStore.setState(sl3Fixture());
});

it('stores a chosen publication date in military format and closes the calendar', async () => {
  const user = userEvent.setup();
  render(<Sl3DateFields />);
  await user.click(screen.getByRole('button', { name: 'Choose publication date' }));
  await user.click(screen.getByRole('button', { name: /Thursday, October 29th, 2026/ }));
  expect(useDocumentStore.getState().formData.date).toBe('29 Oct 26');
  expect(screen.queryByRole('button', { name: /Go to the Next Month/ })).not.toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Publication date checks' })).toHaveTextContent('30 October 2026');
});

it('navigates months and stores signing dates as ISO without silently changing publication date', async () => {
  const user = userEvent.setup();
  render(<Sl3DateFields />);
  await user.click(screen.getByRole('button', { name: 'Choose signing date' }));
  await user.click(screen.getByRole('button', { name: 'Go to the Next Month' }));
  await user.click(screen.getByRole('button', { name: /Tuesday, November 10th, 2026/ }));
  expect(useDocumentStore.getState().formData.publicationSigningDate).toBe('2026-11-10');
  expect(useDocumentStore.getState().formData.date).toBe('30 Oct 26');
  await user.click(screen.getByRole('button', { name: 'Use 30 Nov 26 for publication' }));
  expect(useDocumentStore.getState().formData.date).toBe('30 Nov 26');
});

it('selects and deselects multiple closures and recalculates the working day', async () => {
  const user = userEvent.setup();
  render(<Sl3DateFields />);
  await user.click(screen.getByRole('button', { name: 'Choose office closure dates' }));
  await user.click(screen.getByRole('button', { name: /Thursday, October 29th, 2026/ }));
  await user.click(screen.getByRole('button', { name: /Friday, October 30th, 2026/ }));
  expect(useDocumentStore.getState().formData.publicationClosedDates).toBe('2026-10-29, 2026-10-30');
  expect(screen.getByRole('button', { name: 'Use 28 Oct 26 for publication' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Friday, October 30th, 2026/ }));
  expect(useDocumentStore.getState().formData.publicationClosedDates).toBe('2026-10-29');
});

it('normalizes typed dates on blur and allows clearing them', () => {
  render(<Sl3DateFields />);
  const signing = screen.getByLabelText('Signing date');
  fireEvent.change(signing, { target: { value: 'November 10, 2026' } });
  fireEvent.blur(signing);
  expect(signing).toHaveValue('2026-11-10');
  expect(useDocumentStore.getState().formData.publicationSigningDate).toBe('2026-11-10');
  fireEvent.change(signing, { target: { value: '' } });
  fireEvent.blur(signing);
  expect(useDocumentStore.getState().formData.publicationSigningDate).toBe('');
});

it('retains an invalid ISO day for validation instead of rolling into the next month', () => {
  render(<Sl3DateFields />);
  const signing = screen.getByLabelText('Signing date');
  fireEvent.change(signing, { target: { value: '2026-02-31' } });
  fireEvent.blur(signing);
  expect(useDocumentStore.getState().formData.publicationSigningDate).toBe('2026-02-31');
  expect(screen.getByRole('status', { name: 'Publication date checks' })).toHaveTextContent('Enter a valid signing date.');
  expect(screen.queryByRole('button', { name: /for publication/ })).not.toBeInTheDocument();
});

it('preserves invalid typed closures while adding dates from the calendar', async () => {
  const user = userEvent.setup();
  useDocumentStore.getState().setField('publicationClosedDates', 'invalid');
  render(<Sl3DateFields />);
  await user.click(screen.getByRole('button', { name: 'Choose office closure dates' }));
  await user.click(screen.getByRole('button', { name: /Friday, October 30th, 2026/ }));
  expect(useDocumentStore.getState().formData.publicationClosedDates).toBe('2026-10-30, invalid');
  expect(screen.getByRole('status', { name: 'Publication date checks' })).toHaveTextContent('Enter office closure dates as YYYY-MM-DD');
});

it('keeps global definitions out of individual inventory cards', () => {
  render(<Sl3InventorySection />);
  expect(screen.queryByRole('button', { name: 'Add definition' })).not.toBeInTheDocument();
  expect(screen.getByText(/Definitions apply to the entire publication/)).toBeInTheDocument();
});

it('opens on the selected day and supports choosing a date with the keyboard', async () => {
  const user = userEvent.setup();
  render(<Sl3DateFields />);
  const trigger = screen.getByRole('button', { name: 'Choose publication date' });
  await user.click(trigger);
  expect(screen.getByRole('button', { name: /Friday, October 30th, 2026/ })).toHaveFocus();
  await user.keyboard('{ArrowLeft}{Enter}');
  expect(useDocumentStore.getState().formData.date).toBe('29 Oct 26');
  expect(trigger).toHaveFocus();
});

it('removes the calendar immediately even when an exit animation would retain its hit area', async () => {
  const user = userEvent.setup();
  render(<><style>{`@keyframes calendar-exit { from { opacity: 1; } to { opacity: 0; } }
    [data-slot="popover-content"][data-state="closed"] { animation-name: calendar-exit; animation-duration: 200ms; }`}</style><Sl3DateFields /></>);
  await user.click(screen.getByRole('button', { name: 'Choose publication date' }));
  await user.keyboard('{ArrowLeft}{Enter}');
  expect(screen.queryByRole('button', { name: 'Go to the Previous Month' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Use 30 Oct 26 for publication' }));
  expect(useDocumentStore.getState().formData.date).toBe('30 Oct 26');
});
