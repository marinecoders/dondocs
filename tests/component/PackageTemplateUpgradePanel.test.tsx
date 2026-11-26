import '../_helpers/packageCatalogFixture';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { PackageTemplateUpgradePanel } from '@/components/PackageTemplateUpgradePanel';
import { prepareConditionalPackage, applyPreparedConditionalPackage } from '@/lib/packageConditional';
import { getPackageRevision, listActionPackages, type ActionPackage } from '@/lib/actionPackages';
import { maintenanceFixture } from '../_helpers/packageTemplateMaintenance';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as classification from '@/config/classification';
import * as actions from '@/lib/maintainedPackageActions';
import { useUIStore } from '@/stores/uiStore';
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/lib/pdfText', () => ({ extractPdfText: vi.fn(async () => '') }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(() => { vi.spyOn(classification, 'getExportDeploymentPolicy').mockResolvedValue(policy); vi.spyOn(classification, 'getExportDeploymentPolicySync').mockReturnValue(policy); useUIStore.setState({ storageHealth: 'ok' }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture() {
  const template = maintenanceFixture(), record = (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template, name: 'Synthetic UI upgrade', answers: { version: 1, values: { subject: 'Preserve current answer' }, groups: {} } }, policy), policy, true)).record;
  const target = structuredClone(template); target.id = 'synthetic_target'; target.program.revision = '3'; target.members.push({ ...structuredClone(target.members[0]), key: 'new', role: 'supporting-document', label: 'New supporting letter' });
  return { record, target };
}
const props = (record: ActionPackage) => ({ record, revision: getPackageRevision(record), disabled: false, busy: false, run: async (action: () => Promise<void>) => action(), signal: () => undefined, isCurrent: () => true, onApply: vi.fn() });
it('reviews real membership adoption while preserving the main document and earlier captured revision', async () => {
  const { record, target } = await fixture(); vi.spyOn(actions, 'maintainedPackageAction').mockResolvedValue(target);
  const applied = vi.fn(), dirty = vi.fn(); function Harness() { const [current, setCurrent] = useState(record); return <PackageTemplateUpgradePanel {...props(current)} onDirtyChange={dirty} onApply={next => { applied(next); setCurrent(next); }} />; }
  const user = userEvent.setup(); render(<Harness />);
  await user.selectOptions(screen.getByLabelText('Upgrade template source'), 'maintained:administrative-request'); await user.click(screen.getByRole('button', { name: 'Load upgrade declarations' }));
  await screen.findByText(/Selected target: Synthetic maintained action/);
  await user.click(screen.getByRole('checkbox', { name: /^Preserve unmapped answers/ })); await user.click(screen.getByRole('button', { name: 'Preview template adoption' }));
  const review = await screen.findByRole('checkbox', { name: /^I reviewed the intake, document changes/ });
  await user.click(review); await user.click(screen.getByRole('button', { name: 'Apply action changes' }));
  await waitFor(() => expect(applied).toHaveBeenCalledOnce());
  const saved = applied.mock.calls[0][0] as ActionPackage; expect(getPackageRevision(saved).members).toHaveLength(2); expect(getPackageRevision(saved).members[0]).toEqual(getPackageRevision(record).members[0]);
  expect(saved.revisions.slice(0, -1)).toEqual(record.revisions); await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});
it('drops a loaded template when the selected owner becomes read-only', async () => {
  const { record, target } = await fixture(); let resolve!: (value: typeof target) => void;
  vi.spyOn(actions, 'maintainedPackageAction').mockReturnValueOnce(new Promise(value => { resolve = value; }));
  const user = userEvent.setup(), view = render(<PackageTemplateUpgradePanel {...props(record)} />);
  await user.selectOptions(screen.getByLabelText('Upgrade template source'), 'maintained:administrative-request'); await user.click(screen.getByRole('button', { name: 'Load upgrade declarations' }));
  view.rerender(<PackageTemplateUpgradePanel {...props(record)} disabled />); await act(async () => { resolve(target); });
  expect(screen.queryByText(/Selected target:/)).toBeNull(); expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});
it('revokes a reviewed adoption on a read-only transition and keeps local upgrade choices discardable', async () => {
  const { record, target } = await fixture(); vi.spyOn(actions, 'maintainedPackageAction').mockResolvedValue(target);
  const user = userEvent.setup(), dirty = vi.fn(), view = render(<PackageTemplateUpgradePanel {...props(record)} onDirtyChange={dirty} />);
  await user.selectOptions(screen.getByLabelText('Upgrade template source'), 'maintained:administrative-request'); await user.click(screen.getByRole('button', { name: 'Load upgrade declarations' }));
  await screen.findByText(/Selected target: Synthetic maintained action/); await user.click(screen.getByRole('checkbox', { name: /^Preserve unmapped answers/ })); await user.click(screen.getByRole('button', { name: 'Preview template adoption' }));
  await user.click(await screen.findByRole('checkbox', { name: /^I reviewed the intake, document changes/ }));
  view.rerender(<PackageTemplateUpgradePanel {...props(record)} disabled onDirtyChange={dirty} />);
  expect(screen.getByRole('button', { name: 'Discard upgrade preparation' })).toBeEnabled();
  view.rerender(<PackageTemplateUpgradePanel {...props(record)} onDirtyChange={dirty} />);
  expect(screen.queryByRole('button', { name: 'Apply action changes' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Discard upgrade preparation' }));
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});

it('keeps an operation error visible after the parent clears its active controller', async () => {
  const { record } = await fixture(); vi.spyOn(actions, 'maintainedPackageAction').mockRejectedValueOnce(new Error('Synthetic retained source failure.'));
  let controller: AbortController | undefined;
  const run = async (action: () => Promise<void>) => { controller = new AbortController(); try { await action(); } finally { controller = undefined; } };
  const user = userEvent.setup(); render(<PackageTemplateUpgradePanel {...props(record)} run={run} signal={() => controller?.signal} />);
  await user.selectOptions(screen.getByLabelText('Upgrade template source'), 'maintained:administrative-request');
  await user.click(screen.getByRole('button', { name: 'Load upgrade declarations' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic retained source failure.');
  expect(controller).toBeUndefined(); expect(screen.getByRole('button', { name: 'Load upgrade declarations' })).toBeEnabled();
});
