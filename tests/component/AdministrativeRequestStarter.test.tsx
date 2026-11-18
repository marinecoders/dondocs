import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdministrativeRequestStarter } from '@/components/AdministrativeRequestStarter';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as requestApi from '@/lib/administrativeRequest';
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


it('refuses an in-flight request creation after the starter becomes disabled and requires a new review', async () => {
  const create = requestApi.createPreparedAdministrativeRequest;
  let settled = false; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const spy = vi.spyOn(requestApi, 'createPreparedAdministrativeRequest').mockImplementation(async (...args) => { await gate; try { return await create(...args); } finally { settled = true; } });
  const before = await listActionPackages(), assets = await idbGetAllAttachments(), user = userEvent.setup(), created = vi.fn();
  const props = { disabled: false, busy: false, run: async (action: () => Promise<void>) => { try { await action(); } catch { /* Parent reports rejected operations. */ } }, onCreate: created, signal: () => undefined, isCurrent: () => true };
  const view = render(<AdministrativeRequestStarter {...props} />);
  await user.click(screen.getByRole('button', { name: 'Start an administrative request' }));
  const fields = { Requester: 'Synthetic Person', Organization: 'Synthetic Unit', Recipient: 'Training Officer', 'Request subject': 'Read-only lifecycle',
    'Request date': '2026-11-18', SSIC: '1500', 'Printed signature name': 'S. PERSON', 'Requested action and justification': 'Synthetic request lifecycle verification.' };
  for (const [label, value] of Object.entries(fields)) await user.type(screen.getByLabelText(label, { exact: label !== 'Printed signature name' }), value);
  await user.click(screen.getByRole('button', { name: 'Review request starter' }));
  await user.click(await screen.findByRole('checkbox', { name: /^I reviewed these request details/ }));
  await user.click(screen.getByRole('button', { name: 'Create reviewed request package' }));
  view.rerender(<AdministrativeRequestStarter {...props} disabled />);
  await act(async () => { release(); });
  await waitFor(() => expect(settled).toBe(true));
  expect(await listActionPackages()).toEqual(before); expect(await idbGetAllAttachments()).toEqual(assets); expect(created).not.toHaveBeenCalled();
  view.rerender(<AdministrativeRequestStarter {...props} />);
  expect(screen.queryByRole('button', { name: 'Create reviewed request package' })).toBeNull();
  expect(screen.getByLabelText('Requester', { exact: true })).toHaveValue('Synthetic Person');
  spy.mockRestore();
});
