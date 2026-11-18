import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageRosterPanel } from '@/components/PackageRosterPanel';
import { maintenanceFixture } from '../_helpers/packageTemplateMaintenance';
import { createActionPackage, getPackageRevision, listActionPackages } from '@/lib/actionPackages';
import { listPackageRosters } from '@/lib/packageRoster';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import * as actions from '@/lib/maintainedPackageActions';
import { useUIStore } from '@/stores/uiStore';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(async () => {
  vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy); vi.spyOn(actions, 'maintainedPackageAction').mockResolvedValue(maintenanceFixture()); useUIStore.setState({ storageHealth: 'ok' });
  await createActionPackage('Initialize'); const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('dondocs'); request.onsuccess = () => resolve(request.result); });
  await new Promise<void>(resolve => { const tx = database.transaction([...database.objectStoreNames], 'readwrite'); for (const name of database.objectStoreNames) tx.objectStore(name).clear(); tx.oncomplete = () => resolve(); }); database.close();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const props = () => ({ disabled: false, busy: false, run: async (action: () => Promise<void>) => action(), signal: () => undefined, isCurrent: () => true });
async function newRows(user: ReturnType<typeof userEvent.setup>, count = 2) {
  await user.selectOptions(screen.getByLabelText('Roster template'), 'maintained:administrative-request'); await user.click(screen.getByRole('button', { name: 'Load roster template' }));
  await screen.findByLabelText('Package roster name');
  for (let number = 1; number <= count; number++) { await user.click(screen.getByRole('button', { name: 'Add fresh action row' })); await user.clear(screen.getByLabelText(`Action name for row ${number}`)); await user.type(screen.getByLabelText(`Action name for row ${number}`), `Synthetic action ${number}`); await user.type(within(screen.getByRole('region', { name: `Action row ${number}` })).getByLabelText('Subject', { exact: true }), `Subject for row ${number}`); }
}
it('saves independent row inputs, creates one action, reloads and requires fresh review for the remaining action', async () => {
  const user = userEvent.setup(), created = vi.fn(), dirty = vi.fn(), open = vi.fn(), view = render(<PackageRosterPanel {...props()} onCreated={created} onOpenPackage={open} onDirtyChange={dirty} />);
  await newRows(user); await user.click(screen.getByRole('button', { name: 'Preview roster actions' })); await screen.findByText('Every action row is ready for input review.');
  const save = screen.getByRole('button', { name: 'Save reviewed roster inputs' }); expect(save).toBeDisabled(); await user.click(screen.getByRole('checkbox', { name: /^I reviewed the template, all roster rows/ })); await user.click(save);
  await screen.findByText('Creation inputs saved. Review each action separately before creating it.'); expect(await listActionPackages()).toEqual([]); await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  let create = screen.getByRole('button', { name: 'Create independent package' }); expect(create).toBeDisabled(); await user.click(screen.getByRole('checkbox', { name: /^I reviewed the intake, document changes/ })); await user.click(create);
  await waitFor(() => expect(created).toHaveBeenCalledOnce()); expect((await listActionPackages())).toHaveLength(1); expect(screen.getByRole('checkbox', { name: /^I reviewed the intake, document changes/ })).not.toBeChecked();
  view.unmount(); render(<PackageRosterPanel {...props()} onCreated={created} onOpenPackage={open} />);
  await user.click(screen.getByRole('button', { name: 'Refresh saved rosters' })); const journal = (await listPackageRosters())[0]; await user.selectOptions(screen.getByLabelText('Saved package roster'), journal.id); await user.click(screen.getByRole('button', { name: 'Resume saved roster review' }));
  await screen.findByText('Saved inputs reopened. Each remaining action needs a fresh review.'); create = screen.getByRole('button', { name: 'Create independent package' }); expect(create).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the intake, document changes/ })); await user.click(create); await waitFor(() => expect(created).toHaveBeenCalledTimes(2));
  const packages = await listActionPackages(); expect(packages).toHaveLength(2); expect(packages.map(record => getPackageRevision(record).members[0]).every(member => member.kind === 'native')).toBe(true);
  await user.selectOptions(screen.getByLabelText('Saved roster action'), journal.rows[0].id); await user.click(screen.getByRole('button', { name: 'Open created action row 1' })); await waitFor(() => expect(open).toHaveBeenCalledOnce());
  expect(open.mock.calls[0][0].name).toBe('Synthetic action 1');
});
it('shows invalid rows before any journal write and revokes prepared reviews when switching read-only', async () => {
  const user = userEvent.setup(), view = render(<PackageRosterPanel {...props()} />); await newRows(user, 1);
  await user.clear(within(screen.getByRole('region', { name: 'Action row 1' })).getByLabelText('Subject', { exact: true }));
  await user.click(screen.getByRole('button', { name: 'Preview roster actions' })); await screen.findByText('Correct the action rows before saving.'); expect(screen.getByRole('button', { name: 'Save reviewed roster inputs' })).toBeDisabled(); expect(await listPackageRosters()).toEqual([]);
  await user.type(within(screen.getByRole('region', { name: 'Action row 1' })).getByLabelText('Subject', { exact: true }), 'Corrected subject'); await user.click(screen.getByRole('button', { name: 'Preview roster actions' })); await screen.findByText('Every action row is ready for input review.');
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the template, all roster rows/ }));
  view.rerender(<PackageRosterPanel {...props()} disabled />); await waitFor(() => expect(screen.queryByRole('button', { name: 'Save reviewed roster inputs' })).toBeNull());
  view.rerender(<PackageRosterPanel {...props()} />); expect(screen.queryByRole('button', { name: 'Save reviewed roster inputs' })).toBeNull(); expect(await listPackageRosters()).toEqual([]);
});
it('drops an asynchronous source load on read-only transition and reports a rejected parent operation', async () => {
  let resolve!: (value: ReturnType<typeof maintenanceFixture>) => void; vi.mocked(actions.maintainedPackageAction).mockReturnValueOnce(new Promise(value => { resolve = value; }));
  const user = userEvent.setup(), view = render(<PackageRosterPanel {...props()} />); await user.selectOptions(screen.getByLabelText('Roster template'), 'maintained:administrative-request'); await user.click(screen.getByRole('button', { name: 'Load roster template' }));
  view.rerender(<PackageRosterPanel {...props()} disabled />); await act(async () => { resolve(maintenanceFixture()); }); expect(screen.queryByLabelText('Package roster name')).toBeNull();
  view.unmount(); render(<PackageRosterPanel {...props()} run={async () => { throw new Error('Parent operation unavailable.'); }} />); await user.click(screen.getByRole('button', { name: 'Refresh roster templates' })); expect(await screen.findByRole('alert')).toHaveTextContent('Parent operation unavailable.');
});
it('keeps actual operation failures visible when a parent releases its signal before resolving', async () => {
  let controller: AbortController | undefined;
  vi.mocked(actions.maintainedPackageAction).mockRejectedValueOnce(new Error('Template source unavailable.'));
  const user = userEvent.setup(); render(<PackageRosterPanel {...props()} signal={() => controller?.signal} run={async action => {
    controller = new AbortController(); try { await action(); } finally { controller = undefined; }
  }} />);
  await user.selectOptions(screen.getByLabelText('Roster template'), 'maintained:administrative-request'); await user.click(screen.getByRole('button', { name: 'Load roster template' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Template source unavailable.'); expect(controller).toBeUndefined();
});
