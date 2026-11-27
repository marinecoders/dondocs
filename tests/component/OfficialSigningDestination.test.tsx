import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OfficialFormSigning } from '@/components/OfficialFormSigning';

vi.mock('@/components/pdf/pdfConfig', () => ({ HARDENED_PDF_OPTIONS: {} }));
vi.mock('@/services/forms/signatureLayout', () => ({ readSignatureLayout: async () => ({ sizes: [], slots: [] }) }));
vi.mock('@/components/signingDisclosure', () => ({ confirmSigningDisclosure: vi.fn() }));
vi.mock('@/lib/officialSigning', () => ({ officialRevisionBytes: async () => new Uint8Array([1]) }));
vi.mock('@/services/forms/signingBridge', () => ({
  isDisconnectPending: () => false,
  subscribeSigningSession: () => () => {},
  currentSigningSession: () => 'approved',
  connectSigningCompanion: async () => 'approved',
  inspectOfficialPdf: async () => ({
    formId: 'navmc_118_11', edition: '2014-05', sha256: 'digest',
    fields: [{ name: 'previous', label: 'Previous signer', signed: true }, { name: 'next', label: 'Next signer' }],
  }),
  signingIdentities: async () => [],
}));

it.each(['previous', undefined])('requires an explicit choice for an unavailable or unspecified package field: %s', async initialField => {
  render(<OfficialFormSigning beforeSign={async () => {}} initialField={initialField} onSave={vi.fn()} record={{
    format: 'dondocs-official-signing-v1', filename: 'Training.pdf', id: 'sample', data: '', revisions: [{ length: 1, sha256: 'digest' }],
  }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review for signing' }));
  const selector = await screen.findByRole('combobox', { name: 'Signature field' });
  expect(selector).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Sign with CAC' })).toBeNull();
  fireEvent.change(selector, { target: { value: 'next' } });
  expect(selector).toHaveValue('next');
  expect(screen.getByRole('button', { name: 'Sign with CAC' })).toBeDisabled();
});
