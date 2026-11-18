import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionPackageWorkspace } from '@/components/ActionPackageWorkspace';
import { createExportGate } from '@/lib/exportController';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage } from '@/lib/actionPackages';
import { updatePackageInformation } from '@/lib/packageInformation';
import { PDFDocument } from 'pdf-lib';
import { captureOriginalPackageMember } from '@/lib/actionPackageAssets';
import { preparePackageAssembly, assemblePackage } from '@/lib/actionPackageAssembly';
import { startPackageReview } from '@/lib/packageReviewRounds';
import { updatePackageWork } from '@/lib/packageWork';
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

async function originalPackage() {
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  return reviseActionPackage(await createActionPackage(`Impact ${crypto.randomUUID()}`), [await captureOriginalPackageMember({ name: 'Synthetic retained letter.pdf', data: new Uint8Array(await pdf.save()).buffer }, 'basic-letter', false)]);
}
async function compareSaved(dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>, baseline?: string) {
  await user.click(within(dialog).getByText('Change impact', { selector: 'summary', exact: true }));
  const impact = await within(dialog).findByRole('region', { name: 'Package change impact' });
  if (baseline) await user.selectOptions(within(impact).getByLabelText('Change impact baseline'), baseline);
  await user.click(within(impact).getByRole('button', { name: 'Compare saved revisions' }));
  await within(impact).findByRole('region', { name: 'Package impact details' });
  return impact;
}
it('follows a removed value to its exact historical revision and focuses the saved value', async () => {
  const before = await fixture(), baseline = getPackageRevision(before);
  const record = await updatePackageInformation(before, { ...baseline.information!, facts: baseline.information!.facts.filter(fact => fact.id !== 'end') });
  const { dialog, user } = await open(record.id), impact = await compareSaved(dialog, user, baseline.id);
  await user.click(within(impact).getByText('Shared values (1)', { exact: true }));
  await user.click(within(impact).getByRole('button', { name: 'Inspect shared value · End date · location 1' }));
  await waitFor(() => expect(within(dialog).getByLabelText('Package revision', { exact: true })).toHaveValue(baseline.id));
  await waitFor(() => expect(within(dialog).getByText('End date', { selector: 'legend' })).toHaveFocus());
  expect(within(dialog).getByLabelText('Value 2', { exact: true })).toBeDisabled();
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});
it('opens the exact recorded review from impact while preserving the newer draft', async () => {
  const reviewed = await startPackageReview(await originalPackage()), round = reviewed.reviewRounds![0];
  const record = await updatePackageInformation(reviewed, { version: 1, participants: [], facts: [{ id: 'new-context', label: 'Newer context', kind: 'text', value: 'Preserve this newer saved value', source: { kind: 'entered' } }] });
  const { dialog, user } = await open(record.id), impact = await compareSaved(dialog, user);
  await user.click(within(impact).getByText('Recorded reviews (1)', { exact: true }));
  await user.click(within(impact).getByRole('button', { name: `Inspect review · ${round.label} · location 1` }));
  await within(dialog).findByText('Reviewing exact saved package revision');
  await waitFor(() => expect(dialog.querySelector(`[data-package-review-id="${round.id}"]`)).toHaveFocus());
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
  await user.click(within(dialog).getByRole('button', { name: 'Return to package workspace' }));
  await waitFor(() => expect(within(dialog).getByLabelText('Value 1', { exact: true })).toHaveValue('Preserve this newer saved value'));
});
it('finds an older retained PDF outside the compared pair and opens its exact saved output', async () => {
  const initial = await originalPackage(), prepared = await preparePackageAssembly(initial, initial.currentRevisionId, policy);
  const retained = await assemblePackage(prepared, { compile: vi.fn(), convertDocx: vi.fn(), waitForReady: async () => true });
  const captured = getPackageRevision(retained), output = captured.outputs[0];
  const before = await updatePackageInformation(retained, { version: 1, participants: [], facts: [{ id: 'context', label: 'Context', kind: 'text', value: 'First context', source: { kind: 'entered' } }] });
  const record = await updatePackageInformation(before, { ...getPackageRevision(before).information!, facts: [{ ...getPackageRevision(before).information!.facts[0], kind: 'text', value: 'Second context' }] });
  const { dialog, user } = await open(record.id), impact = await compareSaved(dialog, user);
  await user.click(within(impact).getByText('Retained PDFs (1)', { exact: true }));
  await user.click(within(impact).getByRole('button', { name: 'Inspect retained PDF · Retained PDF 1 · location 1' }));
  await waitFor(() => expect(within(dialog).getByLabelText('Package revision', { exact: true })).toHaveValue(captured.id));
  await waitFor(() => expect(dialog.querySelector(`[data-package-output-id="${output.id}"]`)).toHaveFocus());
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});

it('preserves unsaved tasks through close and queued package selection until discarded', async () => {
  const record = await fixture(), other = await createActionPackage(`Other work ${crypto.randomUUID()}`), { dialog, user } = await open(record.id);
  await user.click(within(dialog).getByText(/^Work and next actions/, { selector: 'summary' }));
  const work = await within(dialog).findByRole('region', { name: 'Work and next actions' });
  await user.click(within(work).getByRole('button', { name: 'Add task' }));
  await user.type(within(work).getByLabelText('Task 1 title'), 'Preserve this unfinished work');
  expect(within(dialog).getByLabelText('Saved packages', { exact: true })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Add shared value' })).toBeDisabled();
  await user.keyboard('{Escape}'); expect(dialog).toBeVisible();
  act(() => useUIStore.getState().openActionPackage(other.id));
  expect(within(work).getByLabelText('Task 1 title')).toHaveValue('Preserve this unfinished work');
  await user.click(within(work).getByRole('button', { name: 'Discard task changes' }));
  await waitFor(() => expect(within(dialog).getByLabelText('Saved packages', { exact: true })).toHaveValue(other.id));
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});
it('keeps real consistency blockers after manual completion and navigates their exact value', async () => {
  const record = await updatePackageWork(await fixture(), { version: 1, tasks: [{ id: 'manual', title: 'Check the dates', status: 'complete' }] }, policy);
  const { dialog, user } = await open(record.id);
  await user.click(within(dialog).getByText(/^Work and next actions/, { selector: 'summary' }));
  const work = await within(dialog).findByRole('region', { name: 'Work and next actions' });
  await user.click(within(work).getByRole('button', { name: 'Check next actions' }));
  await within(work).findByText(/PDF assembly: [1-9]\d* unresolved checks?/);
  expect(within(work).getByText('Action dates', { selector: 'span', exact: true })).toBeVisible();
  await user.click(within(work).getByRole('button', { name: 'Open Action dates', exact: true }));
  await waitFor(() => expect(within(dialog).getByText('Start date', { selector: 'legend' })).toHaveFocus());
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
});
