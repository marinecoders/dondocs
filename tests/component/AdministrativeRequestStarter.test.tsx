import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdministrativeRequestStarter } from '@/components/AdministrativeRequestStarter';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { listActionPackages } from '@/lib/actionPackages';
import { idbGetAllAttachments } from '@/lib/documentsDb';

const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: null, runtime: { status: 'absent' } });
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(),
  getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy,
}));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));

it('reviews fresh intake without saving and cancels it without carrying personal data into the next action', async () => {
  const user = userEvent.setup(), created = vi.fn(), dirty = vi.fn();
  const before = await listActionPackages(), assets = await idbGetAllAttachments();
  render(<AdministrativeRequestStarter disabled={false} busy={false} run={async action => action()} onCreate={created}
    signal={() => undefined} isCurrent={() => true} onDirtyChange={dirty} />);
  const starter = screen.getByRole('region', { name: 'Administrative request starter' });
  await user.click(within(starter).getByRole('button', { name: 'Start an administrative request' }));
  expect(within(starter).getByLabelText('Requester', { exact: true })).toHaveFocus();
  const fields = { Requester: 'Alex Example', Organization: 'Training Unit', Recipient: 'Training Officer', 'Request subject': 'Attend training',
    'Request date': '2026-11-17', SSIC: '1500', 'Printed signature name': 'A. EXAMPLE', 'Requested action and justification': 'Request training for assigned duties.' };
  for (const [label, value] of Object.entries(fields)) {
    const field = within(starter).getByLabelText(label, { exact: label !== 'Printed signature name' });
    expect(field).toHaveValue(''); await user.type(field, value);
  }
  expect(dirty).toHaveBeenCalledWith(true);
  await user.click(within(starter).getByRole('button', { name: 'Review request starter' }));
  await within(starter).findByRole('button', { name: 'Create reviewed request package' });
  expect(within(starter).getByRole('button', { name: 'Create reviewed request package' })).toBeDisabled();
  expect(await listActionPackages()).toEqual(before); expect(await idbGetAllAttachments()).toEqual(assets);
  await user.click(within(starter).getByRole('button', { name: 'Cancel request starter' }));
  expect(within(starter).getByRole('button', { name: 'Start an administrative request' })).toHaveFocus();
  expect(created).not.toHaveBeenCalled();
  await user.click(within(starter).getByRole('button', { name: 'Start an administrative request' }));
  for (const label of Object.keys(fields)) expect(within(starter).getByLabelText(label, { exact: label !== 'Printed signature name' })).toHaveValue('');
  expect(dirty).toHaveBeenLastCalledWith(false);
});
