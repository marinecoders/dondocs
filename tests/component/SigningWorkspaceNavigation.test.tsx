import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SigningWorkspace from '@/components/modals/SigningWorkspace';
import type { SigningRecord } from '@/lib/signingWorkspace';

const storage = vi.hoisted(() => ({ inventory: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/officialSigning', () => ({ officialSigningRecords: async () => [] }));
vi.mock('@/lib/signingWorkspace', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/signingWorkspace')>(),
  loadSigningInventory: storage.inventory,
  updateSigningFields: storage.save,
}));
vi.mock('@/components/SigningPdfPreview', () => ({ SigningPdfPreview: () => null }));
vi.mock('@/components/SigningReturnReview', () => ({ SigningReturnReview: () => null }));

const draft = (id: string) => ({
  id, title: 'Training', revision: 1, createdAt: 1,
  source: { sha256: id, pages: [{ width: 400, height: 600, rotation: 0 }], existingFieldNames: [] },
  fields: [{ id: 'box', signer: id, x: 0.2, y: 0.3, width: 0.4, height: 0.1, page: 0 }],
});
beforeEach(() => {
  storage.inventory.mockResolvedValue({ records: [draft('first'), draft('second')], unreadable: [] });
  storage.save.mockReset().mockImplementation(async (record: SigningRecord, fields) => ({ ...record, fields }));
});

it('keeps an unavailable targeted record out of unrelated drafts', async () => {
  render(<SigningWorkspace open initialRecordId="missing" onOpenChange={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('This signing file is unavailable');
  expect(screen.queryByLabelText('Signer name')).toBeNull();
});

it('guards switching and dismissal and retries failed placement saves', async () => {
  const close = vi.fn();
  render(<SigningWorkspace open initialRecordId="second" onOpenChange={close} />);
  const signer = await screen.findByLabelText('Signer name');
  expect(signer).toHaveValue('second');
  fireEvent.change(signer, { target: { value: 'Modified' } });
  const select = screen.getByRole('combobox', { name: /^Saved signing draft/ });
  const switchDraft = () => fireEvent.change(select, { target: { value: 'first' } });
  switchDraft();
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByText('Keep editing'));
  expect(signer).toHaveValue('Modified');
  expect(select).toHaveValue('second');
  switchDraft();
  storage.save.mockRejectedValueOnce(new Error('Storage unavailable'));
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByText('Save changes'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable');
  expect(signer).toHaveValue('Modified');
  fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Save changes'));
  expect(await screen.findByDisplayValue('first')).toBeInTheDocument();
  expect(storage.save).toHaveBeenCalledTimes(2);
  fireEvent.change(signer, { target: { value: 'Discard me' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByText('Discard'));
  expect(close).toHaveBeenCalledWith(false);
  expect(storage.save).toHaveBeenCalledTimes(2);
});

it('closes without prompting again after storage normalizes a saved placement', async () => {
  storage.save.mockImplementationOnce(async (record: SigningRecord, fields: SigningRecord['fields']) => ({
    ...record, fields: fields.map(field => ({ ...field, signer: field.signer.trim() })),
  }));
  const close = vi.fn();
  render(<SigningWorkspace open initialRecordId="first" onOpenChange={close} />);
  fireEvent.change(await screen.findByLabelText('Signer name'), { target: { value: ' Signer ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save signature placement' }));
  await screen.findByDisplayValue('Signer');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(close).toHaveBeenCalledWith(false);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
