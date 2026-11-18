import 'fake-indexeddb/auto';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageWorkPanel } from '@/components/PackageWorkPanel';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import { updatePackageWork } from '@/lib/packageWork';
import { updatePackageRequirements } from '@/lib/packageRequirements';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import * as nextActions from '@/lib/packageNextActions';

const { activePolicy } = vi.hoisted(() => ({ activePolicy: { value: undefined as unknown } }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
const otherPolicy = resolveExportDeploymentPolicy({ hostname: 'example.mil', environment: null, runtime: { status: 'absent' } });
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => activePolicy.value, getExportDeploymentPolicySync: () => activePolicy.value }));
beforeEach(() => { activePolicy.value = policy; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const fixture = () => createActionPackage(`Synthetic work panel ${crypto.randomUUID()}`);
function Harness({ initial, onDirtyChange }: { initial: ActionPackage; onDirtyChange?(dirty: boolean): void }) {
  const [record, setRecord] = useState(initial), [busy, setBusy] = useState(false);
  return <PackageWorkPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={busy} run={async action => {
    setBusy(true); try { await action(); } finally { setBusy(false); }
  }} onApply={setRecord} onDirtyChange={onDirtyChange} isCurrent={() => true} signal={() => undefined} />;
}
async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Review task changes' }));
  const button = await screen.findByRole('button', { name: 'Save task changes' }); expect(button).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /I reviewed the tasks/ })); await user.click(button);
  await waitFor(() => expect(screen.getByText('Showing saved tasks.')).toBeVisible());
}
it('creates, reviews, saves, completes and reloads actual revision-owned task data without changing evidence', async () => {
  const initial = await fixture(), dirty = vi.fn(), user = userEvent.setup(); render(<Harness initial={initial} onDirtyChange={dirty} />);
  await user.click(screen.getByRole('button', { name: 'Add task' }));
  expect(screen.getByLabelText('Task 1 title')).toHaveFocus();
  await user.type(screen.getByLabelText('Task 1 title'), 'Collect the supporting record');
  await user.type(screen.getByLabelText('Responsible person for task 1'), 'Alex Example');
  await user.type(screen.getByLabelText('Due date for task 1'), '2026-11-18');
  await user.type(screen.getByLabelText('Notes for task 1'), 'Use the reviewed copy.');
  expect(screen.getByRole('button', { name: 'Check next actions' })).toBeDisabled();
  expect(getPackageRevision((await listActionPackages()).find(record => record.id === initial.id)!).work).toBeUndefined();
  await save(user);
  expect(screen.getByText('Tasks saved as a new package revision.')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Work and next actions' })).toHaveFocus();
  const saved = (await listActionPackages()).find(record => record.id === initial.id)!;
  expect(getPackageRevision(saved).work?.tasks[0]).toMatchObject({ title: 'Collect the supporting record', owner: 'Alex Example', dueDate: '2026-11-18', notes: 'Use the reviewed copy.', status: 'pending' });
  expect(getPackageRevision(saved).members).toEqual([]); expect(saved.revisions.slice(0, -1)).toEqual(initial.revisions);
  await user.click(screen.getByLabelText('Mark task 1 complete')); await save(user);
  const completed = (await listActionPackages()).find(record => record.id === initial.id)!;
  expect(getPackageRevision(completed).work?.tasks[0].status).toBe('complete');
  expect(getPackageRevision(saved).work?.tasks[0].status).toBe('pending');
  cleanup(); render(<Harness initial={completed} />); expect(screen.getByLabelText('Mark task 1 complete')).toBeChecked();
  expect(dirty).toHaveBeenLastCalledWith(false);
});
it('keeps invalid date edits, associates the validation message and permits correction before saving', async () => {
  const user = userEvent.setup(); render(<Harness initial={await fixture()} />);
  await user.click(screen.getByRole('button', { name: 'Add task' })); await user.type(screen.getByLabelText('Task 1 title'), 'Verify source');
  const due = screen.getByLabelText('Due date for task 1'); await user.type(due, '2025-02-29');
  expect(due).toHaveAttribute('aria-invalid', 'true'); expect(due).toHaveAccessibleDescription('Use a real date in YYYY-MM-DD format.');
  await user.click(screen.getByRole('button', { name: 'Review task changes' })); await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Task 1 due date:'); expect(due).toHaveValue('2025-02-29');
  await user.clear(due); await user.type(due, '2028-02-29'); expect(due).not.toHaveAttribute('aria-invalid'); await save(user);
});
it('never substitutes manual completion for missing evidence and only inspects saved data on request', async () => {
  let initial = await fixture(); initial = await updatePackageRequirements(initial, { version: 1, items: [{ id: 'supporting', label: 'Supporting original', kind: 'document', operations: ['review'], condition: 'active' }] }, policy);
  initial = await updatePackageWork(initial, { version: 1, tasks: [{ id: 'done', title: 'Ask for the supporting original', status: 'complete' }] }, policy);
  const inspect = vi.spyOn(nextActions, 'derivePackageNextActions'), user = userEvent.setup(); render(<Harness initial={initial} />);
  expect(inspect).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText('Next action operation'), 'review'); await user.click(screen.getByRole('button', { name: 'Check next actions' }));
  await screen.findByText(/Start review: \d+ unresolved checks/);
  expect(screen.getByText(/Supporting original: Assign an actual captured/)).toBeVisible();
  expect(screen.queryByText('Prepare a package review')).toBeNull(); expect(screen.getByLabelText('Mark task 1 complete')).toBeChecked();
});
it('preserves dirty tasks across pages, clears draft edits on discard and bounds editor controls', async () => {
  const initial = await updatePackageWork(await fixture(), { version: 1, tasks: Array.from({ length: 30 }, (_, i) => ({ id: `task-${i}`, title: `Task title ${i}`, status: 'pending' })) }, policy);
  const user = userEvent.setup(); render(<Harness initial={initial} />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(25); await user.clear(screen.getByLabelText('Task 1 title')); await user.type(screen.getByLabelText('Task 1 title'), 'Unapplied first task');
  await user.click(screen.getByRole('button', { name: 'More tasks' })); expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  await user.click(screen.getByRole('button', { name: 'Previous tasks' })); expect(screen.getByLabelText('Task 1 title')).toHaveValue('Unapplied first task');
  await user.click(screen.getByRole('button', { name: 'Discard task changes' })); expect(screen.getByLabelText('Task 1 title')).toHaveValue('Task title 0');
});
it('keeps historical work read-only and shows deleted destinations without reassignment', async () => {
  let initial = await fixture(); initial = await updatePackageRequirements(initial, { version: 1, items: [{ id: 'missing', label: 'Supporting proof', kind: 'document', operations: ['pdf'], condition: 'active' }] }, policy);
  initial = await updatePackageWork(initial, { version: 1, tasks: [{ id: 'linked', title: 'Find supporting proof', status: 'pending', target: { kind: 'requirement', id: 'missing' } }] }, policy);
  const old = getPackageRevision(initial); initial = await reviseActionPackage(initial, []);
  // A removed declaration remains a stale task target rather than becoming a different criterion.
  const revision = { ...getPackageRevision(initial), requirements: { version: 1 as const, items: [] } };
  const user = userEvent.setup(); render(<PackageWorkPanel record={initial} revision={revision} disabled busy={false} run={async action => action()} onApply={vi.fn()} isCurrent={() => true} signal={() => undefined} />);
  expect(screen.getByLabelText('Task 1 title')).toBeDisabled(); expect(screen.getByLabelText('Linked item for task 1')).toHaveValue('requirement:missing');
  expect(screen.getByText('The linked requirement is no longer in this revision.')).toBeVisible();
  cleanup(); render(<PackageWorkPanel record={initial} revision={old} disabled={false} busy={false} run={async action => action()} onApply={vi.fn()} isCurrent={() => true} signal={() => undefined} />);
  expect(screen.getByLabelText('Task 1 title')).toBeDisabled(); await user.selectOptions(screen.getByLabelText('Next action operation'), 'review');
});
it('invalidates reviewed changes on policy changes while retaining draft input', async () => {
  const user = userEvent.setup(); render(<Harness initial={await fixture()} />);
  await user.click(screen.getByRole('button', { name: 'Add task' })); await user.type(screen.getByLabelText('Task 1 title'), 'Keep this draft');
  await user.click(screen.getByRole('button', { name: 'Review task changes' })); await screen.findByRole('button', { name: 'Save task changes' });
  activePolicy.value = otherPolicy; act(() => { window.dispatchEvent(new Event('focus')); });
  expect(screen.queryByRole('button', { name: 'Save task changes' })).toBeNull(); expect(screen.getByLabelText('Task 1 title')).toHaveValue('Keep this draft');
  expect(screen.getByText(/Deployment settings changed/)).toBeVisible();
});
it('restores useful keyboard focus when removing the last unsaved task', async () => {
  const user = userEvent.setup(); render(<Harness initial={await fixture()} />);
  await user.click(screen.getByRole('button', { name: 'Add task' }));
  await user.click(screen.getByRole('button', { name: 'Remove task 1' }));
  expect(screen.getByRole('button', { name: 'Add task' })).toHaveFocus();
});
it('reports a rejected parent operation and leaves saved-action controls recoverable', async () => {
  const user = userEvent.setup(), initial = await fixture();
  render(<PackageWorkPanel record={initial} revision={getPackageRevision(initial)} disabled={false} busy={false}
    run={async () => { throw new Error('The package operation cannot start.'); }} onApply={vi.fn()} isCurrent={() => true} signal={() => undefined} />);
  await user.click(screen.getByRole('button', { name: 'Check next actions' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The package operation cannot start.');
  expect(screen.getByRole('button', { name: 'Check next actions' })).toBeEnabled();
});
it('discards late saved-action inspection from the previously selected package', async () => {
  const first = await fixture(), second = await fixture();
  let release!: (value: nextActions.PackageNextActions) => void;
  vi.spyOn(nextActions, 'derivePackageNextActions').mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const properties = { disabled: false, busy: false, run: async (action: () => Promise<void>) => action(), onApply: vi.fn(), isCurrent: () => true, signal: () => undefined };
  const user = userEvent.setup(), view = render(<PackageWorkPanel {...properties} record={first} revision={getPackageRevision(first)} />);
  await user.click(screen.getByRole('button', { name: 'Check next actions' }));
  view.rerender(<PackageWorkPanel {...properties} record={second} revision={getPackageRevision(second)} />);
  await act(async () => { release({ operation: 'pdf', readyForOperation: true, computedBlockers: 0, pendingTasks: 0,
    actions: [{ id: 'old-ready', kind: 'delivery', label: 'Old package is ready', message: 'This belongs to the previous package.', blocking: false }] }); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check next actions' })).toBeEnabled());
  expect(screen.queryByText('Old package is ready')).toBeNull();
  expect(screen.getByText('Check the saved package to find its next action.')).toBeVisible();
});
it('keeps focus on an exact local task instead of sending a generic panel destination', async () => {
  const initial = await updatePackageWork(await fixture(), { version: 1, tasks: [{ id: 'focus-task', title: 'Inspect this local task', status: 'pending' }] }, policy);
  const navigate = vi.fn(), user = userEvent.setup();
  render(<PackageWorkPanel record={initial} revision={getPackageRevision(initial)} disabled={false} busy={false} run={async action => action()}
    onApply={vi.fn()} isCurrent={() => true} signal={() => undefined} onNavigate={navigate} />);
  await user.click(screen.getByRole('button', { name: 'Check next actions' }));
  await user.click(await screen.findByRole('button', { name: 'Open Inspect this local task' }));
  expect(screen.getByLabelText('Task 1 title')).toHaveFocus();
  expect(navigate).not.toHaveBeenCalled();
});
it('invalidates an outstanding owning inspection when the same revision becomes a review-baseline view', async () => {
  const initial = await fixture();
  let release!: (value: nextActions.PackageNextActions) => void;
  vi.spyOn(nextActions, 'derivePackageNextActions').mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const properties = { record: initial, revision: getPackageRevision(initial), disabled: false, busy: false,
    run: async (action: () => Promise<void>) => action(), onApply: vi.fn(), isCurrent: () => true, signal: () => undefined };
  const user = userEvent.setup(), view = render(<PackageWorkPanel {...properties} />);
  await user.click(screen.getByRole('button', { name: 'Check next actions' }));
  view.rerender(<PackageWorkPanel {...properties} disabled reviewBaseline />);
  await act(async () => { release({ operation: 'review', readyForOperation: true, computedBlockers: 0, pendingTasks: 0,
    actions: [{ id: 'prepare-review', kind: 'delivery', label: 'Prepare a package review', message: 'Old owning inspection.', blocking: false }] }); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check next actions' })).toBeEnabled());
  expect(screen.queryByText('Prepare a package review')).toBeNull();
});
