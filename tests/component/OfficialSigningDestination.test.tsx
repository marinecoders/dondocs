import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OfficialFormSigning } from '@/components/OfficialFormSigning';

vi.mock('@/components/OfficialSignatureLocation', () => ({ OfficialSignatureLocation: () => null }));
vi.mock('@/components/signingDisclosure', () => ({ confirmSigningDisclosure: vi.fn() }));
vi.mock('@/lib/officialSigning', () => ({ officialRevisionBytes: async () => new Uint8Array([1]) }));
vi.mock('@/services/forms/signingBridge', () => ({
  inspectOfficialPdf: async () => ({
    formId: 'navmc_118_11', edition: '2014-05', sha256: 'digest',
    fields: [{ name: 'previous', label: 'Previous signer', signed: true }, { name: 'next', label: 'Next signer' }],
  }),
  signingIdentities: async () => [],
}));

it('requires an explicit new selection when the requested field is already signed', async () => {
  render(<OfficialFormSigning initialField="previous" onSave={vi.fn()} record={{
    format: 'dondocs-official-signing-v1', filename: 'Training.pdf', id: 'sample', data: '', revisions: [{ length: 1, sha256: 'digest' }],
  }} />);
  fireEvent.change(screen.getByLabelText('Local bridge pairing code'), { target: { value: 'sample' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect CAC' }));
  const selector = await screen.findByRole('combobox', { name: 'Signature field' });
  expect(selector).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Sign with CAC' })).toBeNull();
  fireEvent.change(selector, { target: { value: 'next' } });
  expect(selector).toHaveValue('next');
  expect(screen.getByRole('button', { name: 'Sign with CAC' })).toBeDisabled();
});
