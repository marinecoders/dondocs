import 'fake-indexeddb/auto';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageInformationPanel } from '@/components/PackageInformationPanel';
import { createActionPackage, getPackageRevision, listActionPackages, renameActionPackage, reviseActionPackage, type ActionPackage } from '@/lib/actionPackages';
import { capturePackageMember } from '@/lib/actionPackageAssets';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { createBlankSession } from '@/stores/documentStore';
import { updatePackageInformation, type PackageInformation } from '@/lib/packageInformation';
import { applyPreparedPackageUpdate, preparePackageUpdate } from '@/lib/packageUpdates';
import { listPackageBindingFields, type PackageBindingField } from '@/lib/packageBindingTargets';
import * as bindingTargets from '@/lib/packageBindingTargets';
import * as fieldBindings from '@/lib/packageFieldBindings';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
const { currentPolicy } = vi.hoisted(() => ({ currentPolicy: { value: undefined as unknown } }));
vi.mock('@/config/classification', async original => ({ ...await original<typeof import('@/config/classification')>(),
  getExportDeploymentPolicy: async () => currentPolicy.value, getExportDeploymentPolicySync: () => currentPolicy.value }));
vi.mock('@/stores/backupStore', () => ({ scheduleBackup: vi.fn() }));
const policy = resolveExportDeploymentPolicy({ hostname: 'localhost', environment: { maxLevel: 'unclassified', allowedLevels: ['unclassified'] }, runtime: { status: 'absent' } });
beforeEach(() => { currentPolicy.value = policy; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function member(label: string, subject: string, previous?: Parameters<typeof capturePackageMember>[3]) {
  const session = createBlankSession(); session.formData.subject = subject;
  session.paragraphs = [{ id: 'information-ui-body', text: 'Synthetic package information component test.', level: 0 }];
  return capturePackageMember(captureDocumentRevision({ documentId: `information-${label.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`, epoch: 0, editSequence: 1, capturedAt: 100 },
    { ...session, endItems: [], publicationTables: {} }), label, 'basic-letter', previous);
}
async function fixture(subjects: string[] = ['ORIGINAL SUBJECT']) {
  return reviseActionPackage(await createActionPackage('Synthetic package information'), await Promise.all(subjects.map((subject, index) => member(`Document ${index + 1}`, subject))));
}
async function saved(id: string) { return (await listActionPackages()).find(value => value.id === id)!; }
function Harness({ initial, disabled = false, onDirtyChange }: { initial: ActionPackage; disabled?: boolean; onDirtyChange?(dirty: boolean): void }) {
  const [record, setRecord] = useState(initial), [busy, setBusy] = useState(false);
  return <PackageInformationPanel record={record} revision={getPackageRevision(record)} disabled={disabled} busy={busy} onDirtyChange={onDirtyChange}
    isCurrent={() => true} signal={() => undefined} onApply={setRecord} run={async action => { setBusy(true); try { await action(); } finally { setBusy(false); } }} />;
}
async function previewAndApply(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Preview package changes' }));
  const apply = await screen.findByRole('button', { name: 'Apply package changes' });
  expect(apply).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the package values/ }));
  await user.click(apply);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Apply package changes' })).toBeNull());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Undo package changes' })).toBeEnabled());
}

it('keeps lexical identifiers, false and incomplete dates until a reviewed application, then undoes in a new revision', async () => {
  const initial = await fixture(), dirty = vi.fn(), user = userEvent.setup();
  const view = render(<Harness initial={initial} onDirtyChange={dirty} />);
  await user.click(screen.getByRole('button', { name: 'Add shared value' }));
  await user.type(screen.getByLabelText('Value label 1'), 'Control number');
  await user.selectOptions(screen.getByLabelText('Value kind 1'), 'identifier');
  await user.type(screen.getByLabelText('Value 1'), '0000123');
  await user.click(screen.getByRole('button', { name: 'Add shared value' }));
  await user.type(screen.getByLabelText('Value label 2'), 'Travel approved');
  await user.selectOptions(screen.getByLabelText('Value kind 2'), 'boolean');
  expect(screen.getByLabelText('Value 2')).toHaveValue('false');
  await user.click(screen.getByRole('button', { name: 'Add shared value' }));
  await user.type(screen.getByLabelText('Value label 3'), 'Effective date');
  await user.selectOptions(screen.getByLabelText('Value kind 3'), 'date');
  await user.type(screen.getByLabelText('Value 3'), '2026-02-');
  await user.click(screen.getByRole('button', { name: 'Add shared value' }));
  await user.type(screen.getByLabelText('Value label 4'), 'Exact amount');
  await user.selectOptions(screen.getByLabelText('Value kind 4'), 'decimal');
  await user.type(screen.getByLabelText('Value 4'), '0.00');
  view.rerender(<Harness initial={initial} onDirtyChange={dirty} />);
  expect(screen.getByLabelText('Value 3')).toHaveValue('2026-02-');
  expect(screen.getByText('Unapplied changes · not saved to the package yet.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Preview package changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('real date');
  expect(getPackageRevision(await saved(initial.id)).information).toBeUndefined();
  await user.clear(screen.getByLabelText('Value 3')); await user.type(screen.getByLabelText('Value 3'), '2028-02-29');
  await previewAndApply(user);
  const applied = await saved(initial.id);
  expect(getPackageRevision(applied).information?.facts.map(fact => fact.value)).toEqual(['0000123', false, '2028-02-29', '0.00']);
  expect(applied.revisions).toHaveLength(initial.revisions.length + 1);
  expect(screen.getByLabelText('Value kind 1')).toBeDisabled();
  expect(dirty).toHaveBeenLastCalledWith(false);
  await user.click(screen.getByRole('button', { name: 'Undo package changes' }));
  await screen.findByText('Package changes undone in a new revision.');
  const undone = await saved(initial.id);
  expect(getPackageRevision(undone).information).toBeUndefined();
  expect(undone.revisions).toHaveLength(initial.revisions.length + 2);
  expect(undone.revisions.find(revision => revision.id === applied.currentRevisionId)?.information?.facts[0].value).toBe('0000123');
});

it('keeps independent source candidates, adopts explicitly and retains their provenance without making a field link', async () => {
  const initial = await fixture(['FIRST SOURCE SUBJECT', 'SECOND SOURCE SUBJECT']), user = userEvent.setup();
  render(<Harness initial={initial} />);
  await user.click(screen.getByText('Suggestions from documents'));
  await user.click(screen.getByRole('button', { name: 'Inspect document suggestions' }));
  const list = await screen.findByRole('list', { name: 'Document suggestions' });
  const first = within(list).getByText(/FIRST SOURCE SUBJECT/).closest('li')!;
  const second = within(list).getByText(/SECOND SOURCE SUBJECT/).closest('li')!;
  expect(first).not.toBe(second);
  expect(getPackageRevision(await saved(initial.id)).information).toBeUndefined();
  expect(screen.queryByLabelText('Value label 1')).toBeNull();
  await user.click(within(second).getByRole('button', { name: /Adopt suggestion/ }));
  expect(screen.getByLabelText('Value 1')).toHaveValue('SECOND SOURCE SUBJECT');
  expect(screen.getByText('Unapplied changes · not saved to the package yet.')).toBeVisible();
  await previewAndApply(user);
  const current = getPackageRevision(await saved(initial.id));
  expect(current.information?.facts).toHaveLength(1);
  expect(current.information?.facts[0].source).toMatchObject({ kind: 'document', label: 'Document 2' });
  expect(current.bindings?.items ?? []).toEqual([]);
});

it('links an explicit field, previews the exact change, requires a fresh review after edits and saves only that target', async () => {
  const initial = await fixture(), user = userEvent.setup(); render(<Harness initial={initial} />);
  await user.click(screen.getByRole('button', { name: 'Add shared value' }));
  await user.type(screen.getByLabelText('Value label 1'), 'Subject'); await user.type(screen.getByLabelText('Value 1'), 'SHARED SUBJECT');
  await user.click(screen.getByRole('button', { name: 'Load document fields' }));
  const targets = await screen.findByLabelText('Link field for value 1');
  await user.selectOptions(targets, within(targets).getByRole('option', { name: /Document 1 · Subject · ORIGINAL SUBJECT/ }));
  await user.click(screen.getByRole('button', { name: 'Link value 1' }));
  await user.click(screen.getByRole('button', { name: 'Preview package changes' }));
  const preview = await screen.findByRole('region', { name: 'Package changes preview' });
  expect(preview).toHaveTextContent('Current: ORIGINAL SUBJECT'); expect(preview).toHaveTextContent('Package value: SHARED SUBJECT');
  await user.click(screen.getByRole('checkbox', { name: /^I reviewed the package values/ }));
  await user.type(screen.getByLabelText('Value 1'), ' REVISED');
  expect(screen.queryByRole('button', { name: 'Apply package changes' })).toBeNull();
  await previewAndApply(user);
  const current = getPackageRevision(await saved(initial.id)), currentMember = current.members[0];
  expect(currentMember.kind === 'native' && currentMember.session.formData.subject).toBe('SHARED SUBJECT REVISED');
  expect(currentMember.kind === 'native' && currentMember.session.paragraphs[0].text).toBe('Synthetic package information component test.');
  expect(current.bindings?.items[0]).toMatchObject({ expectedValue: 'SHARED SUBJECT REVISED', mode: 'linked' });
});

async function conflictFixture() {
  let record = await fixture();
  const information: PackageInformation = { version: 1, participants: [], facts: [{ id: 'shared-subject', label: 'Subject', kind: 'text', value: 'ORIGINAL SUBJECT', source: { kind: 'entered' } }] };
  record = await updatePackageInformation(record, information);
  const native = getPackageRevision(record).members[0]; if (native.kind !== 'native') throw new Error('Expected native member');
  const field = (await listPackageBindingFields(native)).find(field => field.label === 'Subject')!;
  const plan = await preparePackageUpdate(record, information, { version: 1, items: [{ id: 'subject-link', factId: 'shared-subject', memberId: native.id, target: field.target, expectedValue: field.value, mode: 'linked', format: 'field' }] }, {}, policy);
  record = (await applyPreparedPackageUpdate(plan, policy, true)).record;
  return reviseActionPackage(record, [await member('Document 1', 'LOCAL SUBJECT', native)]);
}
it('surfaces an independent local edit, preserves an explicit override, reconnects and detaches without changing the document value', async () => {
  const initial = await conflictFixture(), user = userEvent.setup(); render(<Harness initial={initial} />);
  await user.clear(screen.getByLabelText('Value 1')); await user.type(screen.getByLabelText('Value 1'), 'NEW PACKAGE SUBJECT');
  await user.click(screen.getByRole('button', { name: 'Preview package changes' }));
  const preview = await screen.findByRole('region', { name: 'Package changes preview' });
  expect(preview).toHaveTextContent('edited independently'); expect(screen.getByRole('button', { name: 'Apply package changes' })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText('Preview decision subject-link'), 'keep-local');
  expect(screen.getByText('Decisions changed. Preview again before applying.')).toBeVisible();
  await previewAndApply(user);
  let current = getPackageRevision(await saved(initial.id));
  expect(current.bindings?.items[0].mode).toBe('override');
  expect(current.members[0].kind === 'native' && current.members[0].session.formData.subject).toBe('LOCAL SUBJECT');
  await user.selectOptions(screen.getByLabelText('Link decision subject-link'), 'reconnect');
  await previewAndApply(user);
  current = getPackageRevision(await saved(initial.id));
  expect(current.bindings?.items[0].mode).toBe('linked');
  expect(current.members[0].kind === 'native' && current.members[0].session.formData.subject).toBe('NEW PACKAGE SUBJECT');
  await user.selectOptions(screen.getByLabelText('Link decision subject-link'), 'detach');
  await previewAndApply(user);
  current = getPackageRevision(await saved(initial.id));
  expect(current.bindings?.items).toEqual([]);
  expect(current.members[0].kind === 'native' && current.members[0].session.formData.subject).toBe('NEW PACKAGE SUBJECT');
});

it('edits people with stable roles, refuses removing referenced people and discards only unapplied work', async () => {
  const initial = await fixture(), user = userEvent.setup(); render(<Harness initial={initial} />);
  await user.click(screen.getByText('People (0)')); await user.click(screen.getByRole('button', { name: 'Add person' }));
  await user.type(screen.getByLabelText('Person label 1'), 'Synthetic requester'); await user.selectOptions(screen.getByLabelText('Person role 1'), 'requester');
  await user.click(screen.getByRole('button', { name: 'Add shared value' })); await user.type(screen.getByLabelText('Value label 1'), 'Name'); await user.type(screen.getByLabelText('Value 1'), 'Synthetic person');
  await user.selectOptions(screen.getByLabelText('Value person 1'), within(screen.getByLabelText('Value person 1')).getByRole('option', { name: 'Synthetic requester · requester' }));
  expect(screen.getByRole('button', { name: 'Remove person 1' })).toBeDisabled();
  await previewAndApply(user);
  expect(screen.getByLabelText('Person role 1')).toBeDisabled(); expect(screen.getByLabelText('Value person 1')).toBeDisabled();
  await user.type(screen.getByLabelText('Value 1'), ' unsaved');
  await user.click(screen.getByRole('button', { name: 'Discard unapplied changes' }));
  expect(screen.getByLabelText('Value 1')).toHaveValue('Synthetic person');
  expect(getPackageRevision(await saved(initial.id)).information?.participants[0].role).toBe('requester');
});

it('rejects policy changes, makes historical records read-only and ignores an old preview after owner selection changes', async () => {
  const initial = await fixture(), user = userEvent.setup();
  const noRun = async (action: () => Promise<void>) => action();
  const props = { disabled: false, busy: false, run: noRun, onApply: vi.fn(), isCurrent: () => true, signal: () => undefined };
  const view = render(<PackageInformationPanel {...props} record={initial} revision={getPackageRevision(initial)} />);
  await user.click(screen.getByRole('button', { name: 'Add shared value' })); await user.type(screen.getByLabelText('Value label 1'), 'Subject');
  await user.type(screen.getByLabelText('Value 1'), 'Pending');
  currentPolicy.value = { status: 'error', message: 'Synthetic deployment policy changed' };
  await user.click(screen.getByRole('button', { name: 'Preview package changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic deployment policy changed');
  currentPolicy.value = policy;
  let release!: () => void;
  const delayed = { ...props, run: async (action: () => Promise<void>) => { await new Promise<void>(resolve => { release = resolve; }); await action(); } };
  view.rerender(<PackageInformationPanel {...delayed} record={initial} revision={getPackageRevision(initial)} />);
  await user.click(screen.getByRole('button', { name: 'Preview package changes' }));
  const other = await fixture(['OTHER DOCUMENT']);
  view.rerender(<PackageInformationPanel {...delayed} record={other} revision={getPackageRevision(other)} />);
  await act(async () => { release(); });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Package changes preview' })).toBeNull());
  expect(props.onApply).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Value 1')).toBeNull();
  view.rerender(<PackageInformationPanel {...props} record={initial} revision={initial.revisions[0]} />);
  expect(screen.getByRole('button', { name: 'Add shared value' })).toBeDisabled();
  expect(screen.getByText('Information is read-only in historical, archived and reviewer copies.')).toBeVisible();
});

it('preserves unapplied values when deployment policy changes after review and never publishes the rejected plan', async () => {
  const initial = await fixture(), user = userEvent.setup(); render(<Harness initial={initial} />);
  await user.click(screen.getByRole('button', { name: 'Add shared value' }));
  await user.type(screen.getByLabelText('Value label 1'), 'Private identifier');
  await user.selectOptions(screen.getByLabelText('Value kind 1'), 'identifier');
  await user.type(screen.getByLabelText('Value 1'), '0000999');
  await user.click(screen.getByRole('button', { name: 'Preview package changes' }));
  await user.click(await screen.findByRole('checkbox', { name: /^I reviewed the package values/ }));
  currentPolicy.value = { status: 'error', message: 'Policy changed after the preview' };
  await user.click(screen.getByRole('button', { name: 'Apply package changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Policy changed after the preview');
  expect(screen.getByLabelText('Value 1')).toHaveValue('0000999');
  expect(screen.queryByRole('button', { name: 'Apply package changes' })).toBeNull();
  expect((await saved(initial.id)).revisions).toHaveLength(initial.revisions.length);
});

it('rejects an independently changed saved package, retaining the draft for a fresh decision', async () => {
  const initial = await fixture(), user = userEvent.setup(); render(<Harness initial={initial} />);
  await user.click(screen.getByRole('button', { name: 'Add shared value' }));
  await user.type(screen.getByLabelText('Value label 1'), 'Subject'); await user.type(screen.getByLabelText('Value 1'), 'My unapplied subject');
  await user.click(screen.getByRole('button', { name: 'Preview package changes' }));
  await user.click(await screen.findByRole('checkbox', { name: /^I reviewed the package values/ }));
  const latest = await updatePackageInformation(initial, { version: 1, participants: [], facts: [{ id: 'other-value', label: 'Other browser value', kind: 'text', value: 'Saved elsewhere', source: { kind: 'entered' } }] });
  await user.click(screen.getByRole('button', { name: 'Apply package changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('saved package changed');
  expect(screen.getByLabelText('Value 1')).toHaveValue('My unapplied subject');
  expect((await saved(initial.id)).currentRevisionId).toBe(latest.currentRevisionId);
});


it('keeps Undo for its own apply but clears it after an intervening saved metadata change', async () => {
  let latest = await fixture();
  const user = userEvent.setup();
  const base = { disabled: false, busy: false, run: async (action: () => Promise<void>) => action(), isCurrent: () => true, signal: () => undefined };
  function onApply(record: ActionPackage) { latest = record; view.rerender(<PackageInformationPanel {...base} record={record} revision={getPackageRevision(record)} onApply={onApply} />); }
  const view = render(<PackageInformationPanel {...base} record={latest} revision={getPackageRevision(latest)} onApply={onApply} />);
  await user.click(screen.getByRole('button', { name: 'Add shared value' }));
  await user.type(screen.getByLabelText('Value label 1'), 'Subject'); await user.type(screen.getByLabelText('Value 1'), 'Saved subject');
  await previewAndApply(user);
  expect(screen.getByRole('button', { name: 'Undo package changes' })).toBeEnabled();
  const revisionId = latest.currentRevisionId;
  latest = await renameActionPackage(latest, 'Renamed in another package control');
  expect(latest.currentRevisionId).toBe(revisionId);
  view.rerender(<PackageInformationPanel {...base} record={latest} revision={getPackageRevision(latest)} onApply={onApply} />);
  expect(screen.queryByRole('button', { name: 'Undo package changes' })).toBeNull();
  expect(screen.getByLabelText('Value 1')).toHaveValue('Saved subject');
});


function manyFields(count: number): PackageBindingField[] {
  return Array.from({ length: count }, (_, index) => ({ label: `Field ${String(index).padStart(3, '0')}`, kind: 'text', value: `Source ${index}`,
    target: { kind: 'configured-form', formId: 'synthetic-form', definitionRevision: '1', templateRevision: '1', definitionSha256: 'a'.repeat(64), fieldId: `field-${index}` } }));
}
it('bounds large field lists, searches later targets and clears hidden selections without adopting anything', async () => {
  const initial = await fixture(), user = userEvent.setup();
  vi.spyOn(bindingTargets, 'listPackageBindingFields').mockResolvedValueOnce(manyFields(105));
  render(<Harness initial={initial} />);
  await user.click(screen.getByRole('button', { name: 'Add shared value' })); await user.type(screen.getByLabelText('Value label 1'), 'Shared');
  await user.type(screen.getByLabelText('Value 1'), 'A shared value');
  await user.click(screen.getByRole('button', { name: 'Load document fields' }));
  const select = await screen.findByLabelText('Link field for value 1');
  expect(within(select).getAllByRole('option')).toHaveLength(101);
  expect(screen.getByText('100 compatible fields shown. More are available; refine your search.')).toBeVisible();
  await user.type(screen.getByLabelText('Search fields for value 1'), 'Field 104');
  expect(within(select).getAllByRole('option')).toHaveLength(2);
  await user.selectOptions(select, within(select).getByRole('option', { name: 'Document 1 · Field 104 · Source 104' }));
  expect(screen.getByRole('button', { name: 'Link value 1' })).toBeEnabled();
  await user.clear(screen.getByLabelText('Search fields for value 1'));
  expect(screen.getByRole('button', { name: 'Link value 1' })).toBeDisabled();
  expect(getPackageRevision(await saved(initial.id)).bindings).toBeUndefined();
});

it('pages source suggestions with a fixed DOM size and remembers deliberate destinations between pages', async () => {
  const initial = await fixture(), native = getPackageRevision(initial).members[0], user = userEvent.setup();
  vi.spyOn(fieldBindings, 'suggestPackageFieldValues').mockResolvedValueOnce(manyFields(30).map((field, index) => ({ memberId: native.id, memberRevisionId: native.revisionId,
    target: field.target, label: field.label, kind: 'text', value: `Suggestion ${index}`,
    source: { kind: 'document', label: native.label, field: `${field.label} [${'a'.repeat(64)}]`, capturedAt: 100 } })));
  render(<Harness initial={initial} />);
  await user.click(screen.getByRole('button', { name: 'Add shared value' })); await user.type(screen.getByLabelText('Value label 1'), 'Existing value');
  await user.click(screen.getByText('Suggestions from documents')); await user.click(screen.getByRole('button', { name: 'Inspect document suggestions' }));
  let list = await screen.findByRole('list', { name: 'Document suggestions' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(25);
  const destination = screen.getByLabelText('Suggestion destination 1');
  await user.selectOptions(destination, within(destination).getByRole('option', { name: 'Existing value · Package-wide' }));
  const selected = (destination as HTMLSelectElement).value;
  await user.click(screen.getByRole('button', { name: 'Show more suggestions' }));
  list = screen.getByRole('list', { name: 'Document suggestions' }); expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  expect(screen.getByText('Suggestions 26–30 of 30')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Previous suggestions' }));
  expect(screen.getByLabelText('Suggestion destination 1')).toHaveValue(selected);
  expect(screen.getByLabelText('Value 1')).toHaveValue('');
  expect(screen.queryByLabelText('Value 2')).toBeNull();
  expect(within(screen.getByRole('list', { name: 'Document suggestions' })).getAllByRole('listitem')).toHaveLength(25);
});


it('identifies same-label adoption destinations by person and role and updates only the selected fact', async () => {
  const information: PackageInformation = { version: 1, participants: [
    { id: 'requester-person', label: 'Requesting Marine', role: 'requester' },
    { id: 'approver-person', label: 'Approving Officer', role: 'approver' },
  ], facts: [
    { id: 'requester-name', label: 'Name', participantId: 'requester-person', kind: 'text', value: 'ORIGINAL REQUESTER', source: { kind: 'entered' } },
    { id: 'approver-name', label: 'Name', participantId: 'approver-person', kind: 'text', value: 'ORIGINAL APPROVER', source: { kind: 'entered' } },
    { id: 'package-name', label: 'Name', kind: 'text', value: 'ORIGINAL PACKAGE NAME', source: { kind: 'entered' } },
  ] };
  const initial = await updatePackageInformation(await fixture(['CAPTURED APPROVER NAME']), information), user = userEvent.setup();
  render(<Harness initial={initial} />);
  await user.click(screen.getByText('Suggestions from documents'));
  await user.click(screen.getByRole('button', { name: 'Inspect document suggestions' }));
  const list = await screen.findByRole('list', { name: 'Document suggestions' });
  const candidate = within(list).getByText(/CAPTURED APPROVER NAME/).closest('li')!;
  const destination = within(candidate).getByRole('combobox');
  expect(within(destination).getByRole('option', { name: 'Name · Requesting Marine · requester' })).toHaveValue('requester-name');
  expect(within(destination).getByRole('option', { name: 'Name · Package-wide' })).toHaveValue('package-name');
  await user.selectOptions(destination, within(destination).getByRole('option', { name: 'Name · Approving Officer · approver' }));
  expect(destination).toHaveValue('approver-name');
  await user.click(within(candidate).getByRole('button', { name: /Adopt suggestion/ }));
  expect(screen.getByLabelText('Value 1')).toHaveValue('ORIGINAL REQUESTER');
  expect(screen.getByLabelText('Value 2')).toHaveValue('CAPTURED APPROVER NAME');
  expect(screen.getByLabelText('Value 3')).toHaveValue('ORIGINAL PACKAGE NAME');
  expect(getPackageRevision(await saved(initial.id)).information).toEqual(information);
  await previewAndApply(user);
  const current = getPackageRevision(await saved(initial.id)).information!;
  expect(current.facts.find(fact => fact.id === 'requester-name')).toEqual(information.facts[0]);
  expect(current.facts.find(fact => fact.id === 'approver-name')).toMatchObject({ participantId: 'approver-person', value: 'CAPTURED APPROVER NAME', source: { kind: 'document', label: 'Document 1' } });
  expect(current.facts.find(fact => fact.id === 'package-name')).toEqual(information.facts[2]);
  expect(current.participants).toEqual(information.participants);
});
