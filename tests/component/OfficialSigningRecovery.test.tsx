import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OfficialFormSigning } from '@/components/OfficialFormSigning';

const bridge = vi.hoisted(() => ({
  inspect: vi.fn(), sign: vi.fn(), save: vi.fn(),
}));
vi.mock('@/components/OfficialSignatureLocation', () => ({ OfficialSignatureLocation: () => null }));
vi.mock('@/components/signingDisclosure', () => ({ confirmSigningDisclosure: async () => {} }));
vi.mock('@/lib/officialSigning', () => ({
  officialRevisionBytes: async () => Uint8Array.of(1),
  saveOfficialRevision: bridge.save,
}));
vi.mock('@/services/forms/signingBridge', () => ({
  subscribeSigningSession: () => () => {}, currentSigningSession: () => 'approved',
  connectSigningCompanion: async () => 'approved', isDisconnectPending: () => false,
  signingIdentities: async () => [{ fingerprint: 'training', label: 'Training certificate' }],
  inspectOfficialPdf: bridge.inspect, signOfficialPdf: bridge.sign,
}));

it.each(['verify', 'save'])('recovers the original signed bytes after a failed %s without signing again', async failure => {
  const pdf = Uint8Array.of(1, 2);
  const record = { format: 'dondocs-official-signing-v1' as const, filename: 'Training.pdf', id: 'training', data: 'AQ==',
    revisions: [{ length: 1, sha256: 'first' }] };
  const inspection = { formId: 'navmc_118_11', edition: '2014-05', sha256: 'first',
    fields: [{ name: 'entry', label: 'Entry', signed: false, trusted: false, locked: false }] };
  const signed = { ...inspection, sha256: 'second', fields: [{ ...inspection.fields[0], signed: true, trusted: true }] };
  bridge.inspect.mockReset().mockResolvedValueOnce(inspection);
  if (failure === 'verify') bridge.inspect.mockRejectedValueOnce(new Error('Interrupted'));
  bridge.inspect.mockResolvedValue(signed);
  bridge.sign.mockReset().mockResolvedValue(pdf);
  bridge.save.mockReset();
  if (failure === 'save') bridge.save.mockRejectedValueOnce(new Error('Interrupted'));
  bridge.save.mockResolvedValue({ ...record, data: 'AQI=', revisions: [...record.revisions, { length: 2, sha256: 'second' }] });
  const onSave = vi.fn();
  render(<OfficialFormSigning record={record} initialField="entry" onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review for signing' }));
  fireEvent.click(await screen.findByLabelText(/I reviewed the exact PDF/));
  fireEvent.click(screen.getByRole('button', { name: 'Sign with CAC' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Interrupted');
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry verification and save' }));
  expect(await screen.findByText('Signed PDF ready.')).toBeVisible();
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(bridge.sign).toHaveBeenCalledTimes(1);
  expect(bridge.inspect.mock.calls.at(-1)?.[0]).toBe(pdf);
  expect(bridge.save.mock.calls.at(-1)?.[1]).toBe(pdf);
});
