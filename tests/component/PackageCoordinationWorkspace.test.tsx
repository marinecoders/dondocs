import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionPackageWorkspace } from '@/components/ActionPackageWorkspace';
import { createExportGate } from '@/lib/exportController';
import { createActionPackage, getPackageRevision, listActionPackages } from '@/lib/actionPackages';
import { updatePackageInformation } from '@/lib/packageInformation';
import { updatePackageConsistency } from '@/lib/packageConsistency';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { PACKAGE_WORKSPACE_CONTEXT_KEY } from '@/lib/packageWorkspaceContext';
import { useUIStore } from '@/stores/uiStore';

const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(),
  getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
beforeEach(() => { localStorage.removeItem(PACKAGE_WORKSPACE_CONTEXT_KEY); useUIStore.setState({ actionPackagesOpen: false, isMobile: false, sidebarCollapsed: false }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const record = await updatePackageInformation(await createActionPackage(`Coordination ${crypto.randomUUID()}`), { version: 1, participants: [], facts: [
    { id: 'start', label: 'Start date', kind: 'date', value: '2026-11-19', source: { kind: 'entered' } },
    { id: 'end', label: 'End date', kind: 'date', value: '2026-11-17', source: { kind: 'entered' } },
  ] });
  return updatePackageConsistency(record, { version: 1, rules: [{ id: 'date-order', label: 'Action dates', relation: 'date-on-or-before', leftFactId: 'start', rightFactId: 'end', required: true }], exceptions: [] }, policy);
}
async function open(id: string) {
  useUIStore.getState().openActionPackage(id);
  render(<ActionPackageWorkspace exportGate={createExportGate()} ports={{ compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true }} />);
  const dialog = await screen.findByRole('dialog', { name: 'Action packages' }), user = userEvent.setup();
  await waitFor(() => expect(within(dialog).getByLabelText('Saved packages', { exact: true })).toHaveValue(id));
  await user.click(within(dialog).getByText(/^Consistency checks/));
  const relationships = await within(dialog).findByRole('region', { name: 'Package relationships' });
  return { dialog, user, relationships };
}

it('opens real relationship findings and focuses the exact confirmed value without changing the saved package', async () => {
  const record = await fixture(), { dialog, user, relationships } = await open(record.id);
  await user.click(within(relationships).getByRole('button', { name: 'Check declared relationships' }));
  await within(relationships).findByText(/The first date is later than the second date\./);
  await user.click(within(relationships).getByRole('button', { name: /Inspect Package · End date for Action dates/ }));
  await waitFor(() => expect(within(dialog).getByText('End date', { selector: 'legend' })).toHaveFocus());
  expect(within(dialog).getByLabelText('Value 2', { exact: true })).toHaveValue('2026-11-17');
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});

it('preserves unsaved relationships through close and queued selection until explicitly discarded', async () => {
  const record = await fixture(), other = await createActionPackage(`Other coordination ${crypto.randomUUID()}`), { dialog, user, relationships } = await open(record.id);
  const label = within(relationships).getByRole('textbox', { name: 'Relationship label 1' });
  await user.clear(label); await user.type(label, 'Unapplied relationship name');
  expect(within(dialog).getByLabelText('Saved packages', { exact: true })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Add shared value' })).toBeDisabled();
  await user.keyboard('{Escape}'); expect(dialog).toBeVisible(); expect(label).toHaveValue('Unapplied relationship name');
  act(() => useUIStore.getState().openActionPackage(other.id));
  expect(within(dialog).getByLabelText('Saved packages', { exact: true })).toHaveValue(record.id);
  await user.click(within(relationships).getByRole('button', { name: 'Discard relationship changes' }));
  await waitFor(() => expect(within(dialog).getByLabelText('Saved packages', { exact: true })).toHaveValue(other.id));
  expect(getPackageRevision((await listActionPackages()).find(item => item.id === record.id)!).consistency).toEqual(getPackageRevision(record).consistency);
});
