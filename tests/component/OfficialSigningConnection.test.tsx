import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OfficialFormSigning } from '@/components/OfficialFormSigning';
import { disconnectSigningCompanion } from '@/services/forms/signingBridge';
import { portableResourceDigest } from '@/lib/portableResources';
import type { OfficialSigningRecord } from '@/lib/officialSigning';

vi.mock('@/components/OfficialSignatureLocation', () => ({ OfficialSignatureLocation: () => null }));
const disclosure = vi.hoisted(() => vi.fn());
vi.mock('@/components/signingDisclosure', () => ({ confirmSigningDisclosure: disclosure }));

afterEach(async () => {
  await disconnectSigningCompanion(new AbortController().signal);
  vi.unstubAllGlobals();
  disclosure.mockReset();
});

it('requires disclosure for each document and reuses native approval from a package in standalone signing', async () => {
  const sha256 = await portableResourceDigest(Uint8Array.of(1).buffer);
  const record: OfficialSigningRecord = {
    format: 'dondocs-official-signing-v1', id: 'training', filename: 'Training.pdf',
    data: 'AQ==', revisions: [{ length: 1, sha256 }],
  };
  const paths: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    paths.push(path);
    switch (path) {
      case '/session': return Response.json({ token: 's'.repeat(43), expiresIn: 900, maxAgeSeconds: 14_400 });
      case '/identities': return Response.json([]);
      case '/disconnect':
        if (paths.filter(path => path === '/disconnect').length === 1) throw new Error('Network interrupted');
        return Response.json({}, { status: 401 });
      case '/inspect': return Response.json({ formId: 'navmc_118_11', edition: '2014-05', sha256, fields: [] });
      default: throw new Error('Unexpected request ' + path);
    }
  });
  vi.stubGlobal('fetch', fetch);
  const pkg = render(<OfficialFormSigning record={record} onSave={vi.fn()} beforeSign={vi.fn()} />);
  expect(paths).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Connect CAC' }));
  expect(await screen.findByRole('button', { name: 'Retry card' })).toBeEnabled();
  expect(paths).toEqual(['/session', '/inspect', '/identities']);
  fireEvent.click(screen.getByRole('button', { name: 'Retry card' }));
  await screen.findByText('Insert your CAC, then retry.');
  expect(paths).toEqual(['/session', '/inspect', '/identities', '/identities']);
  pkg.unmount();

  disclosure.mockRejectedValueOnce(new Error('Inspection cancelled.'));
  render(<OfficialFormSigning record={{ ...record, filename: 'Second.pdf' }} onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Review for signing' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Inspection cancelled.');
  expect(paths).toEqual(['/session', '/inspect', '/identities', '/identities']);
  fireEvent.click(screen.getByRole('button', { name: 'Review for signing' }));
  await screen.findByRole('button', { name: 'Retry card' });
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Connect CAC' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Retry card' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry disconnect' }));
  expect(await screen.findByText('Disconnected.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Connect CAC' })).toBeVisible();
  expect(paths).toEqual(['/session', '/inspect', '/identities', '/identities', '/inspect', '/identities', '/disconnect', '/disconnect']);
});

it.each([true, false])('opens only the requested field on a partially signed PDF (editable: %s)', async editable => {
  const sha256 = await portableResourceDigest(Uint8Array.of(1).buffer);
  const record: OfficialSigningRecord = { format: 'dondocs-official-signing-v1', id: 'retained', filename: 'Training.pdf',
    data: 'AQ==', revisions: [{ length: 1, sha256 }] };
  const name = 'Next signer';
  const slot = { name, label: name, locked: false, signed: false, trusted: null, lockAction: '', lockFields: [] };
  const field = { id: 'notes', label: 'Notes', kind: 'text', value: '', options: [], multiline: false };
  const { PackageSigningRequirementError } = await import('@/lib/packageDestinations');
  const issue = new PackageSigningRequirementError('Record the date before signing.',
    { memberId: 'form', correction: { kind: 'edit', fieldKey: 'date', label: 'Fill notice date' } }, true);
  vi.stubGlobal('fetch', async (url: string) => {
    switch (new URL(url).pathname) {
      case '/session': return Response.json({ token: 's'.repeat(43), expiresIn: 900, maxAgeSeconds: 14_400 });
      case '/identities': return Response.json([]);
      case '/inspect': return Response.json({ formId: 'navmc10132', edition: '2023-08', sha256,
        fields: [slot, { ...slot, name: 'Earlier signer', signed: true, trusted: true }] });
      case '/fields': return Response.json({ sha256, fields: editable ? [field, { ...field, id: 'date', label: 'Notice date' }] : [field] });
      case '/disconnect': return Response.json({});
      default: throw new Error('Unexpected request: ' + url);
    }
  });
  render(<OfficialFormSigning record={record} initialField={name} onSave={vi.fn()} beforeSign={async () => { throw issue; }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Fill notice date' }));
  if (editable) {
    expect(await screen.findByRole('textbox', { name: 'Notice date' })).toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Field' })).toHaveValue('date');
  } else {
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot be edited');
    expect(screen.queryByRole('region', { name: 'Edit unlocked fields' })).toBeNull();
  }
  expect(screen.getByRole('button', { name: 'Sign with CAC' })).toBeDisabled();
});
