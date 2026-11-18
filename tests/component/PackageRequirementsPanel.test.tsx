import 'fake-indexeddb/auto';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageRequirementsPanel } from '@/components/PackageRequirementsPanel';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { updatePackageRequirements, type PackageRequirements } from '@/lib/packageRequirements';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => policy, getExportDeploymentPolicySync: () => policy }));
afterEach(cleanup);
async function fixture(requirements?: PackageRequirements) {
  const session = createBlankSession(); session.formData.subject = 'SYNTHETIC EVIDENCE PANEL';
  const member = await capturePackageMember(captureDocumentRevision({ documentId: 'requirement-panel', epoch: 0, editSequence: 1, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), 'Captured supporting letter', 'basic-letter');
  const record = await reviseActionPackage(await createActionPackage(`Synthetic evidence panel ${crypto.randomUUID()}`), [member]);
  return updatePackageRequirements(record, requirements ?? { version: 1, items: [
    { id: 'supporting-pdf', label: 'Supporting document', kind: 'document', operations: ['pdf'], condition: 'active' },
    { id: 'source-confirmation', label: 'Source checked', kind: 'confirmation', operations: ['review'], condition: 'active' },
  ] }, policy);
}
function Harness({ initial }: { initial: ActionPackage }) {
  const [record, setRecord] = useState(initial), [busy, setBusy] = useState(false);
  return <PackageRequirementsPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={busy} onApply={setRecord} signal={() => undefined} isCurrent={() => true}
    run={async action => { setBusy(true); try { await action(); } finally { setBusy(false); } }} />;
}
it('inspects operation-specific evidence, saves actual assignment and user declaration in a new revision, and never claims approval', async () => {
  const initial = await fixture(), user = userEvent.setup(); render(<Harness initial={initial} />);
  await user.click(screen.getByRole('button', { name: 'Check evidence requirements' }));
  await screen.findByText(/PDF assembly requirement checks have unresolved items/);
  expect(screen.queryByRole('checkbox', { name: 'User declaration for supporting-pdf' })).toBeNull();
  await user.selectOptions(screen.getByLabelText('Evidence for supporting-pdf'), within(screen.getByLabelText('Evidence for supporting-pdf')).getByRole('option', { name: '1. Captured supporting letter · Editable document' }));
  await user.click(screen.getByRole('checkbox', { name: 'User declaration for source-confirmation' }));
  expect(screen.getByText('Unapplied requirement changes · not saved yet.')).toBeVisible();
  expect(getPackageRevision((await listActionPackages()).find(record => record.id === initial.id)!).requirements?.items[0]).not.toHaveProperty('memberId');
  await user.click(screen.getByRole('button', { name: 'Review requirement changes' }));
  const save = await screen.findByRole('button', { name: 'Save requirement changes' }); expect(save).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /I reviewed these evidence assignments/ })); await user.click(save);
  await screen.findByText('Requirements saved as a new revision. Unresolved evidence remains visible.');
  const saved = (await listActionPackages()).find(record => record.id === initial.id)!;
  expect(saved.revisions).toHaveLength(initial.revisions.length + 1);
  expect(getPackageRevision(saved).requirements?.items).toEqual([
    { ...getPackageRevision(initial).requirements!.items[0], memberId: getPackageRevision(initial).members[0].id },
    { ...getPackageRevision(initial).requirements!.items[1], confirmed: true },
  ]);
  await user.click(screen.getByRole('button', { name: 'Check evidence requirements' }));
  await screen.findByText(/PDF assembly requirement checks complete/);
  await user.selectOptions(screen.getByLabelText('Requirement operation'), 'review'); await user.click(screen.getByRole('button', { name: 'Check evidence requirements' }));
  await screen.findByText(/Review requirement checks complete/);
  expect(screen.getByText(/satisfied: User-declared confirmation/)).toHaveTextContent('not an approval');
});
it('retains unknown and missing slots and permits read-only inspection without a checkbox bypass', async () => {
  let initial = await fixture({ version: 1, items: [
    { id: 'unknown-evidence', label: 'Conditional evidence', kind: 'document', operations: ['portable'], condition: 'unknown' },
    { id: 'deleted-evidence', label: 'Removed evidence', kind: 'document', operations: ['portable'], condition: 'active' },
  ] });
  const removedId = getPackageRevision(initial).members[0].id;
  const declarations = structuredClone(getPackageRevision(initial).requirements!);
  declarations.items = declarations.items.map(item => item.id === 'deleted-evidence' ? { ...item, memberId: removedId } : item);
  initial = await reviseActionPackage(await updatePackageRequirements(initial, declarations, policy), []);
  const user = userEvent.setup();
  render(<PackageRequirementsPanel record={{ ...initial, archived: true }} revision={getPackageRevision(initial)} disabled={false} busy={false} onApply={vi.fn()} signal={() => undefined} isCurrent={() => true} run={async action => action()} />);
  expect(screen.getByLabelText('Evidence for unknown-evidence')).toBeDisabled();
  expect(screen.getByLabelText('Evidence for deleted-evidence')).toHaveValue(removedId);
  expect(screen.queryByRole('checkbox')).toBeNull();
  await user.selectOptions(screen.getByLabelText('Requirement operation'), 'portable'); await user.click(screen.getByRole('button', { name: 'Check evidence requirements' }));
  await screen.findByText(/Editable transfer requirement checks have unresolved items/);
  expect(screen.getByText(/unknown: The condition is unresolved/)).toBeVisible();
  expect(screen.getByText(/missing: Assign an actual captured/)).toBeVisible();
});
it('bounds the requirement editor and preserves unapplied declarations between pages and resets', async () => {
  const initial = await fixture({ version: 1, items: Array.from({ length: 30 }, (_, index) => ({ id: `confirmation-${index}`, label: `Synthetic confirmation ${index}`, kind: 'confirmation', operations: ['review'], condition: 'active' })) }), user = userEvent.setup();
  render(<Harness initial={initial} />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(25);
  await user.click(screen.getByRole('checkbox', { name: 'User declaration for confirmation-0' }));
  await user.click(screen.getByRole('button', { name: 'More requirements' })); expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  await user.click(screen.getByRole('button', { name: 'Previous requirements' }));
  expect(screen.getByRole('checkbox', { name: 'User declaration for confirmation-0' })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Discard requirement changes' }));
  expect(screen.getByRole('checkbox', { name: 'User declaration for confirmation-0' })).not.toBeChecked();
  await waitFor(() => expect(screen.getByText('Showing saved requirement declarations.')).toBeVisible());
});
