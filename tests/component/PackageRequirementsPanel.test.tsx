import 'fake-indexeddb/auto';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageRequirementsPanel } from '@/components/PackageRequirementsPanel';
import { createActionPackage, getPackageRevision, listActionPackages, reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { updatePackageRequirements, type PackageRequirements } from '@/lib/packageRequirements';
import { prepareConditionalPackage, applyPreparedConditionalPackage, saveConditionalPackageDraft } from '@/lib/packageConditional';
import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';
import { buildPortableActionPackage, importPortableActionPackage } from '@/lib/actionPackageTransfer';
import * as conditionalRequirements from '@/lib/packageConditionalRequirements';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
const { currentPolicy } = vi.hoisted(() => ({ currentPolicy: { value: undefined as unknown } }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(), getExportDeploymentPolicy: async () => currentPolicy.value, getExportDeploymentPolicySync: () => currentPolicy.value }));
beforeEach(() => { currentPolicy.value = policy; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function fixture(requirements?: PackageRequirements) {
  const session = createBlankSession(); session.formData.subject = 'SYNTHETIC EVIDENCE PANEL';
  const member = await capturePackageMember(captureDocumentRevision({ documentId: 'requirement-panel', epoch: 0, editSequence: 1, capturedAt: 100 }, { ...session, endItems: [], publicationTables: {} }), 'Captured supporting letter', 'basic-letter');
  const record = await reviseActionPackage(await createActionPackage(`Synthetic evidence panel ${crypto.randomUUID()}`), [member]);
  return updatePackageRequirements(record, requirements ?? { version: 1, items: [
    { id: 'supporting-pdf', label: 'Supporting document', kind: 'document', operations: ['pdf'], condition: 'active' },
    { id: 'source-confirmation', label: 'Source checked', kind: 'confirmation', operations: ['review'], condition: 'active' },
  ] }, policy);
}
function Harness({ initial, onDirtyChange }: { initial: ActionPackage; onDirtyChange?(dirty: boolean): void }) {
  const [record, setRecord] = useState(initial), [busy, setBusy] = useState(false);
  return <PackageRequirementsPanel record={record} revision={getPackageRevision(record)} disabled={false} busy={busy} onApply={setRecord} onDirtyChange={onDirtyChange} signal={() => undefined} isCurrent={() => true}
    run={async action => { setBusy(true); try { await action(); } finally { setBusy(false); } }} />;
}
it('inspects operation-specific evidence, saves actual assignment and user declaration in a new revision, and never claims approval', async () => {
  const initial = await fixture(), user = userEvent.setup(); render(<Harness initial={initial} />);
  await user.click(screen.getByRole('button', { name: 'Check evidence requirements' }));
  await screen.findByText(/PDF assembly requirement checks have unresolved items/);
  expect(screen.queryByRole('checkbox', { name: 'User declaration for Supporting document · Package-wide · Requirement 1' })).toBeNull();
  await user.selectOptions(screen.getByLabelText('Evidence for Supporting document · Package-wide · Requirement 1'), within(screen.getByLabelText('Evidence for Supporting document · Package-wide · Requirement 1')).getByRole('option', { name: '1. Captured supporting letter · Editable document' }));
  await user.click(screen.getByRole('checkbox', { name: 'User declaration for Source checked · Package-wide · Requirement 2' }));
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
  expect(screen.getByLabelText('Evidence for Conditional evidence · Package-wide · Requirement 1')).toBeDisabled();
  expect(screen.getByLabelText('Evidence for Removed evidence · Package-wide · Requirement 2')).toHaveValue(removedId);
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
  await user.click(screen.getByRole('checkbox', { name: 'User declaration for Synthetic confirmation 0 · Package-wide · Requirement 1' }));
  await user.click(screen.getByRole('button', { name: 'More requirements' })); expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  await user.click(screen.getByRole('button', { name: 'Previous requirements' }));
  expect(screen.getByRole('checkbox', { name: 'User declaration for Synthetic confirmation 0 · Package-wide · Requirement 1' })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Discard requirement changes' }));
  expect(screen.getByRole('checkbox', { name: 'User declaration for Synthetic confirmation 0 · Package-wide · Requirement 1' })).not.toBeChecked();
  await waitFor(() => expect(screen.getByText('Showing saved requirement declarations.')).toBeVisible());
});


it('requires a fresh human review after the deployment changes to another valid policy and preserves the draft', async () => {
  const initial = await fixture(), user = userEvent.setup(); render(<Harness initial={initial} />);
  await user.selectOptions(screen.getByLabelText('Evidence for Supporting document · Package-wide · Requirement 1'), getPackageRevision(initial).members[0].id);
  await user.click(screen.getByRole('button', { name: 'Review requirement changes' }));
  await user.click(await screen.findByRole('checkbox', { name: /I reviewed these evidence assignments/ }));
  currentPolicy.value = resolveExportDeploymentPolicy({ hostname: 'second.example.mil', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
  await user.click(screen.getByRole('button', { name: 'Save requirement changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Deployment settings changed. Review the requirement changes again.');
  expect(screen.getByLabelText('Evidence for Supporting document · Package-wide · Requirement 1')).toHaveValue(getPackageRevision(initial).members[0].id);
  expect(screen.getByText('Unapplied requirement changes · not saved yet.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Save requirement changes' })).toBeNull();
  expect((await listActionPackages()).find(record => record.id === initial.id)?.currentRevisionId).toBe(initial.currentRevisionId);
});

async function legacyConditionalPackage(pending = false) {
  const session = createBlankSession(undefined, 'standard_letter');
  session.formData = { ...session.formData, signatureType: 'none', subject: '', sigFirst: '', sigMiddle: '', sigLast: '', classLevel: 'unclassified' };
  const template: PackageTemplateV2 = { kind: 'dondocs-package-template', version: 2, id: `legacy-template-${crypto.randomUUID()}`, name: 'Legacy evidence action', createdAt: 0,
    program: { revision: '1', questions: [{ id: 'subject', label: 'Subject', kind: 'text', required: true }], participantGroups: [],
      requirements: [{ id: 'supporting-proof', label: 'Supporting proof', kind: 'document', operations: ['pdf'] }] },
    members: [{ key: 'main', kind: 'native', label: 'Legacy main letter', role: 'basic-letter', required: true,
      draft: { ...session, timestamp: 0, kind: 'dondocs-draft', version: 2, documentKind: 'correspondence' }, pages: {},
      links: [{ questionId: 'subject', target: { kind: 'correspondence', docType: 'standard_letter', field: 'subject' }, format: 'field' }] }] };
  if (pending) template.program.requirements = [{ id: 'source-declaration', label: 'Source checked', kind: 'confirmation', operations: ['pdf'] }];
  const original = pending ? await saveConditionalPackageDraft({ template, answers: { version: 1, values: {}, groups: {} } }, policy)
    : (await applyPreparedConditionalPackage(await prepareConditionalPackage({ template, answers: { version: 1, values: { subject: 'SYNTHETIC LEGACY EVIDENCE' }, groups: {} } }, policy), policy, true)).record;
  const envelope = JSON.parse(await buildPortableActionPackage(original));
  envelope.package.id = `legacy-package-${crypto.randomUUID()}`;
  for (const revision of envelope.package.revisions) { delete revision.requirements; if (pending) revision.templateState.requirementIds = []; }
  return importPortableActionPackage(JSON.stringify(envelope));
}
it('loads effective legacy requirements without dirtying, saves an assignment in a child revision and inspects historical slots read-only', async () => {
  const initial = await legacyConditionalPackage(), dirty = vi.fn(), user = userEvent.setup();
  expect(getPackageRevision(initial).requirements).toBeUndefined();
  const view = render(<Harness initial={initial} onDirtyChange={dirty} />);
  expect(screen.queryByText('No evidence requirements are declared for this revision.')).toBeNull();
  const proof = (await screen.findByRole('heading', { name: 'Supporting proof' })).closest('article')!;
  expect(dirty).not.toHaveBeenCalledWith(true);
  const select = within(proof).getByRole('combobox');
  await user.selectOptions(select, getPackageRevision(initial).members[0].id);
  await user.click(screen.getByRole('button', { name: 'Review requirement changes' }));
  await user.click(await screen.findByRole('checkbox', { name: /I reviewed these evidence assignments/ }));
  await user.click(screen.getByRole('button', { name: 'Save requirement changes' }));
  await screen.findByText('Requirements saved as a new revision. Unresolved evidence remains visible.');
  const saved = (await listActionPackages()).find(record => record.id === initial.id)!;
  expect(saved.revisions).toHaveLength(initial.revisions.length + 1);
  expect(getPackageRevision(saved).requirements?.items.find(item => item.definitionId === 'supporting-proof')).toMatchObject({ memberId: getPackageRevision(initial).members[0].id });
  expect(saved.revisions[0].requirements).toBeUndefined();
  view.unmount();
  render(<PackageRequirementsPanel record={saved} revision={getPackageRevision(initial)} disabled={false} busy={false} onApply={vi.fn()} signal={() => undefined} isCurrent={() => true} run={async action => action()} />);
  const historical = (await screen.findByRole('heading', { name: 'Supporting proof' })).closest('article')!;
  expect(within(historical).getByRole('combobox')).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Check evidence requirements' }));
  await screen.findByText(/PDF assembly requirement checks have unresolved items/);
});
it('ignores a legacy requirement load after switching to a different owner', async () => {
  const legacy = await legacyConditionalPackage(), plain = await createActionPackage(`Plain ${crypto.randomUUID()}`);
  let complete!: (value: PackageRequirements) => void;
  vi.spyOn(conditionalRequirements, 'resolveConditionalPackageRequirements').mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const props = { disabled: false, busy: false, onApply: vi.fn(), isCurrent: () => true, signal: () => undefined, run: async (action: () => Promise<void>) => action() };
  const view = render(<PackageRequirementsPanel {...props} record={legacy} revision={getPackageRevision(legacy)} />);
  expect(screen.getByText('Reading captured requirements…')).toBeVisible();
  view.rerender(<PackageRequirementsPanel {...props} record={plain} revision={getPackageRevision(plain)} />);
  await act(async () => { complete({ version: 1, items: [{ id: 'late-old-slot', label: 'Late old evidence', kind: 'document', operations: ['pdf'], condition: 'active' }] }); });
  expect(screen.queryByRole('heading', { name: 'Late old evidence' })).toBeNull();
  expect(screen.getByText('No evidence requirements are declared for this revision.')).toBeVisible();
});


it('captures stable requirement ids when saving a declaration in a legacy pending draft', async () => {
  const initial = await legacyConditionalPackage(true), user = userEvent.setup();
  expect(getPackageRevision(initial).templateState?.requirementIds).toEqual([]);
  render(<Harness initial={initial} />);
  const article = (await screen.findByRole('heading', { name: 'Source checked' })).closest('article')!;
  await user.click(screen.getByRole('button', { name: 'Check evidence requirements' }));
  await screen.findByText(/PDF assembly requirement checks have unresolved items/);
  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(within(article).getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Review requirement changes' }));
  await user.click(await screen.findByRole('checkbox', { name: /I reviewed these evidence assignments/ }));
  await user.click(screen.getByRole('button', { name: 'Save requirement changes' }));
  await screen.findByText('Requirements saved as a new revision. Unresolved evidence remains visible.');
  const saved = (await listActionPackages()).find(record => record.id === initial.id)!, revision = getPackageRevision(saved);
  expect(saved.revisions).toHaveLength(initial.revisions.length + 1);
  expect(revision.templateState?.pending).toBe(true);
  expect(revision.requirements?.items[0]).toMatchObject({ kind: 'confirmation', confirmed: true });
  expect(revision.templateState?.requirementIds[0].id).toBe(revision.requirements?.items[0].id);
  expect(saved.revisions[0].templateState?.requirementIds).toEqual([]);
});
