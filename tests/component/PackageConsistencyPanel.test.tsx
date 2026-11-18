import 'fake-indexeddb/auto';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageConsistencyPanel } from '@/components/PackageConsistencyPanel';
import { createActionPackage, getPackageRevision, listActionPackages, type ActionPackage } from '@/lib/actionPackages';
import { updatePackageInformation } from '@/lib/packageInformation';
import { updatePackageConsistency, type PackageConsistency } from '@/lib/packageConsistency';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';

const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
const changedPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });
const { currentPolicy } = vi.hoisted(() => ({ currentPolicy: { value: undefined as unknown } }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy.value, getExportDeploymentPolicySync: () => currentPolicy.value }));
const rule = { id: 'date-order', label: 'Action dates', relation: 'date-on-or-before' as const, leftFactId: 'start', rightFactId: 'end', required: true };
async function fixture(consistency?: PackageConsistency) {
  const record = await updatePackageInformation(await createActionPackage(`Synthetic panel ${crypto.randomUUID()}`), { version: 1, participants: [], facts: [
    { id: 'start', label: 'Start date', kind: 'date', value: '2026-11-19', source: { kind: 'entered' } },
    { id: 'end', label: 'End date', kind: 'date', value: '2026-11-17', source: { kind: 'entered' } },
  ] });
  return consistency ? updatePackageConsistency(record, consistency, policy) : record;
}
function Harness({ initial, onDirtyChange, onNavigate }: { initial: ActionPackage; onDirtyChange?(dirty: boolean): void; onNavigate?: (target: { factId: string }) => void }) {
  const [record, setRecord] = useState(initial), abort = useRef(new AbortController());
  return <PackageConsistencyPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={false} run={async action => action()} onApply={setRecord}
    signal={() => abort.current.signal} isCurrent={() => true} onDirtyChange={onDirtyChange} onNavigate={onNavigate} />;
}
beforeEach(() => { currentPolicy.value = policy; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('authors a typed relationship, preserves dirty state until reviewed saving, and navigates the exact finding values', async () => {
  const record = await fixture(), dirty = vi.fn(), navigate = vi.fn(), user = userEvent.setup();
  render(<Harness initial={record} onDirtyChange={dirty} onNavigate={navigate} />);
  await user.click(screen.getByText('Add a relationship', { exact: true }));
  await user.type(screen.getByLabelText('New relationship label'), 'Action dates');
  expect(dirty).toHaveBeenLastCalledWith(true);
  await user.selectOptions(screen.getByLabelText('Relationship type'), 'date-on-or-before');
  await user.selectOptions(screen.getByLabelText('First package value'), 'start');
  await user.selectOptions(screen.getByLabelText('Second package value'), 'end');
  await user.click(screen.getByRole('button', { name: 'Add relationship to changes' }));
  expect((await listActionPackages()).find(item => item.id === record.id)).toEqual(record);
  await user.click(screen.getByRole('button', { name: 'Check declared relationships' }));
  await screen.findByText(/first date is later/);
  expect(screen.getByRole('button', { name: /Inspect Package · Start date for Action dates/ })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Review relationship changes' }));
  await user.click(screen.getByRole('checkbox', { name: 'I reviewed the relationship declarations, local exceptions and privacy findings.' }));
  await user.click(screen.getByRole('button', { name: 'Save relationship changes' }));
  await screen.findByText('Relationships saved as a new revision.');
  const stored = (await listActionPackages()).find(item => item.id === record.id)!;
  expect(stored.revisions).toHaveLength(record.revisions.length + 1); expect(getPackageRevision(stored).consistency?.rules[0]).toMatchObject({ label: 'Action dates', leftFactId: 'start', rightFactId: 'end' });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  await user.click(screen.getByRole('button', { name: /Inspect Package · Start date for Action dates/ }));
  expect(navigate).toHaveBeenCalledWith({ factId: 'start' });
});

it('records a conflict-only exception, saves its reason, and inspects the original historical declaration read-only', async () => {
  const initial = await fixture({ version: 1, rules: [rule], exceptions: [] }), user = userEvent.setup();
  const { unmount } = render(<Harness initial={initial} />);
  await user.click(screen.getByRole('button', { name: 'Check declared relationships' }));
  await user.type(await screen.findByLabelText('Exception reason for Action dates'), 'The dates describe separate deliberate processing windows.');
  await user.click(screen.getByRole('button', { name: 'Add exception to changes' }));
  expect(screen.getByText(/Local exception: The dates/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Review relationship changes' }));
  await user.click(screen.getByRole('checkbox', { name: 'I reviewed the relationship declarations, local exceptions and privacy findings.' }));
  await user.click(screen.getByRole('button', { name: 'Save relationship changes' }));
  await screen.findByText('Relationships saved as a new revision.');
  const saved = (await listActionPackages()).find(item => item.id === initial.id)!;
  expect(getPackageRevision(saved).consistency?.exceptions[0].reason).toBe('The dates describe separate deliberate processing windows.');
  unmount();
  render(<PackageConsistencyPanel record={saved} revision={getPackageRevision(initial)} disabled busy={false} run={async action => action()} onApply={vi.fn()} signal={() => undefined} isCurrent={() => true} />);
  expect(screen.getByLabelText('Relationship label 1')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Save relationship changes' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Check declared relationships' }));
  await screen.findByText(/first date is later/);
  expect(screen.queryByText(/Local exception:/)).not.toBeInTheDocument();
  expect((await listActionPackages()).find(item => item.id === saved.id)).toEqual(saved);
});

it('retains an unapplied draft when deployment settings change after human review', async () => {
  const initial = await fixture({ version: 1, rules: [rule], exceptions: [] }), user = userEvent.setup();
  render(<Harness initial={initial} />);
  await user.clear(screen.getByLabelText('Relationship label 1')); await user.type(screen.getByLabelText('Relationship label 1'), 'Changed dates label');
  await user.click(screen.getByRole('button', { name: 'Review relationship changes' }));
  await user.click(screen.getByRole('checkbox', { name: 'I reviewed the relationship declarations, local exceptions and privacy findings.' }));
  currentPolicy.value = changedPolicy;
  await user.click(screen.getByRole('button', { name: 'Save relationship changes' }));
  await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('Deployment settings changed');
  expect(screen.getByLabelText('Relationship label 1')).toHaveValue('Changed dates label');
  expect((await listActionPackages()).find(item => item.id === initial.id)).toEqual(initial);
});

it('returns to an available page after removing the final relationship on a later page', async () => {
  const initial = await fixture({ version: 1, rules: Array.from({ length: 26 }, (_, index) => ({ ...rule, id: `rule-${index}`, label: `Rule ${index + 1}` })), exceptions: [] });
  const user = userEvent.setup(); render(<Harness initial={initial} />);
  expect(screen.queryByLabelText('Relationship label 26')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'More relationships' }));
  expect(screen.getByLabelText('Relationship label 26')).toHaveValue('Rule 26');
  await user.click(screen.getByRole('button', { name: 'Remove relationship Rule 26' }));
  expect(screen.getByLabelText('Relationship label 1')).toHaveValue('Rule 1');
  expect(screen.queryByRole('button', { name: 'More relationships' })).not.toBeInTheDocument();
});
